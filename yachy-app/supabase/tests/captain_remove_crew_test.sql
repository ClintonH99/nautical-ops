-- Disposable database only: load minimal_foundation_schema, auth helpers,
-- the production users RLS/guard functions, and the crew-removal migration first.
BEGIN;

INSERT INTO public.vessels (id, name, invite_code) VALUES
 ('10000000-0000-0000-0000-000000000001', 'Removal test', 'REMOVE1'),
 ('10000000-0000-0000-0000-000000000002', 'Other vessel', 'REMOVE2');
INSERT INTO public.rotation_groups (id, vessel_id)
VALUES ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
INSERT INTO public.users (id, vessel_id, role, email, contract_type, rotation_group_id, vessel_joined_at) VALUES
 ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'CAPTAIN_MOV', 'captain@test.invalid', 'permanent', NULL, now()),
 ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'CREW', 'crew@test.invalid', 'rotational', '30000000-0000-0000-0000-000000000001', now()),
 ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'HOD', 'hod@test.invalid', 'permanent', NULL, now()),
 ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'CAPTAIN_MOV', 'secondcaptain@test.invalid', 'permanent', NULL, now()),
 ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'CREW', 'outsider@test.invalid', 'permanent', NULL, now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE blocked BOOLEAN := FALSE; returned_id UUID;
BEGIN
  -- Reproduce the exact old update-returning path, with production RLS enabled.
  BEGIN
    UPDATE public.users SET vessel_id = NULL
    WHERE id = '20000000-0000-0000-0000-000000000003' RETURNING id INTO returned_id;
  EXCEPTION WHEN insufficient_privilege THEN blocked := TRUE;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Old removal should reproduce RLS rejection'; END IF;
  IF NOT public.remove_current_vessel_crew_member('20000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'Captain removal failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = '20000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'Captain can still read detached private profile';
  END IF;
  IF current_setting('nautical_ops.trusted_user_change', true) = 'on' THEN
    RAISE EXCEPTION 'Trusted change flag leaked';
  END IF;
END $$;

-- Missing authentication cannot remove anyone.
SELECT set_config('request.jwt.claim.sub', '', true);
DO $$
DECLARE blocked BOOLEAN := FALSE;
BEGIN
  BEGIN PERFORM public.remove_current_vessel_crew_member('20000000-0000-0000-0000-000000000003');
  EXCEPTION WHEN raise_exception THEN blocked := TRUE; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Unauthenticated removal allowed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);

-- No subscription/crew-limit gate may prevent the Captain from removing users.
RESET ROLE;
INSERT INTO public.vessel_subscriptions (vessel_id, status, current_period_end)
VALUES ('10000000-0000-0000-0000-000000000001', 'revoked', now() - INTERVAL '1 month');
SET LOCAL ROLE authenticated;
SELECT public.remove_current_vessel_crew_member('20000000-0000-0000-0000-000000000003');
SELECT public.remove_current_vessel_crew_member('20000000-0000-0000-0000-000000000004');

DO $$
DECLARE target UUID; blocked BOOLEAN;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    '20000000-0000-0000-0000-000000000001'::UUID, -- self
    '20000000-0000-0000-0000-000000000005'::UUID, -- another vessel
    '20000000-0000-0000-0000-000000000099'::UUID, -- missing
    '20000000-0000-0000-0000-000000000002'::UUID  -- already detached
  ] LOOP
    blocked := FALSE;
    BEGIN PERFORM public.remove_current_vessel_crew_member(target);
    EXCEPTION WHEN raise_exception THEN blocked := TRUE; END;
    IF NOT blocked THEN RAISE EXCEPTION 'Invalid target allowed: %', target; END IF;
  END LOOP;
END $$;

-- Detached users retain their own account, but immediately lose shared vessel reads.
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND vessel_id IS NULL) THEN
    RAISE EXCEPTION 'Removed user lost own profile';
  END IF;
  IF public.current_user_can_access_vessel('10000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Removed user retained old vessel access';
  END IF;
END $$;

RESET ROLE;
-- Test an onboard HOD, ordinary crew member and detached Captain as callers.
SELECT set_config('request.jwt.claim.sub', '', true);
UPDATE public.users SET vessel_id = '10000000-0000-0000-0000-000000000001'
WHERE id IN ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003');
SET LOCAL ROLE authenticated;
DO $$
DECLARE actor UUID; blocked BOOLEAN;
BEGIN
  FOREACH actor IN ARRAY ARRAY[
    '20000000-0000-0000-0000-000000000002'::UUID,
    '20000000-0000-0000-0000-000000000003'::UUID,
    '20000000-0000-0000-0000-000000000004'::UUID
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub', actor::TEXT, true);
    blocked := FALSE;
    BEGIN PERFORM public.remove_current_vessel_crew_member('20000000-0000-0000-0000-000000000001');
    EXCEPTION WHEN raise_exception THEN blocked := TRUE; END;
    IF NOT blocked THEN RAISE EXCEPTION 'Unauthorized actor removed Captain: %', actor; END IF;
  END LOOP;
END $$;

RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.users) <> 5 THEN RAISE EXCEPTION 'Removal deleted accounts'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = '20000000-0000-0000-0000-000000000002'
    AND (rotation_group_id IS NOT NULL OR vessel_joined_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'Removal retained old membership metadata';
  END IF;
  IF has_function_privilege('anon', 'public.remove_current_vessel_crew_member(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous removal exposed';
  END IF;
END $$;
ROLLBACK;
SELECT 'Captain crew-removal tests passed' AS result;
