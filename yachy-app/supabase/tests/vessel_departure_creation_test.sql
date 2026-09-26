-- Run in the disposable database with production users RLS and both September 27 migrations.
BEGIN;
INSERT INTO public.vessels (id, name, invite_code, is_solo) VALUES
 ('10000000-0000-0000-0000-000000000001', 'Shared A', 'A', FALSE),
 ('10000000-0000-0000-0000-000000000002', 'New Crew private', 'PRIVATE', TRUE);
INSERT INTO public.users (id, vessel_id, role, email, contract_type, department_2, paused) VALUES
 ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'CAPTAIN_MOV', 'captain@test.invalid', 'rotational', 'BRIDGE', TRUE),
 ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'HOD', 'hod@test.invalid', 'rotational', 'BRIDGE', TRUE),
 ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'CREW', 'crew@test.invalid', 'temporary', NULL, FALSE),
 ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'CREW', 'newcrew@test.invalid', 'permanent', NULL, FALSE),
 ('20000000-0000-0000-0000-000000000005', NULL, 'CAPTAIN_MOV', 'newcaptain@test.invalid', 'permanent', NULL, FALSE);
INSERT INTO public.sea_mile_entries (user_id, vessel_name) VALUES
 ('20000000-0000-0000-0000-000000000002', 'Historical vessel');
INSERT INTO public.notes (user_id, vessel_id) VALUES
 ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001');

-- The last Captain cannot leave; a private workspace cannot qualify as a departure.
DO $$ DECLARE blocked BOOLEAN;
BEGIN
  blocked := FALSE;
  BEGIN PERFORM public.admin_leave_current_vessel('20000000-0000-0000-0000-000000000001');
  EXCEPTION WHEN raise_exception THEN blocked := TRUE; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Last Captain left'; END IF;
  blocked := FALSE;
  BEGIN PERFORM public.admin_leave_current_vessel('20000000-0000-0000-0000-000000000004');
  EXCEPTION WHEN raise_exception THEN blocked := TRUE; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Private account granted departure permission'; END IF;
END $$;

-- Cover Crew and Captain removal, and Crew/HOD voluntary departure too.
INSERT INTO public.users (id, vessel_id, role, email) VALUES
 ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'CREW', 'removecrew@test.invalid'),
 ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'HOD', 'leavehod@test.invalid'),
 ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'CAPTAIN_MOV', 'removecaptain@test.invalid'),
 ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'CREW', 'leavecrew@test.invalid');
SELECT public.admin_leave_current_vessel('20000000-0000-0000-0000-000000000007');
SELECT public.admin_leave_current_vessel('20000000-0000-0000-0000-000000000009');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
SELECT public.remove_current_vessel_crew_member('20000000-0000-0000-0000-000000000006');
SELECT public.remove_current_vessel_crew_member('20000000-0000-0000-0000-000000000008');
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.users u JOIN public.vessels v ON v.id = u.vessel_id
    WHERE u.id IN ('20000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000007',
      '20000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000009')
    AND u.role = 'CREW' AND u.vessel_creation_unlocked AND v.is_solo) <> 4 THEN
    RAISE EXCEPTION 'Departure role matrix failed'; END IF;
END $$;
-- A former Crew user can create; joining instead consumes the same permission.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000006', true);
SELECT public.create_captain_vessel('Former Crew new vessel');
RESET ROLE;
INSERT INTO public.vessel_subscriptions (vessel_id, status, plan_tier, current_period_end)
VALUES ('10000000-0000-0000-0000-000000000001', 'active', '6_10', now() + INTERVAL '1 month');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000009', true);
SELECT public.join_current_user_to_vessel('A');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND vessel_creation_unlocked) THEN
    RAISE EXCEPTION 'Joining retained independent creation permission'; END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000004', true);
DO $$ DECLARE blocked BOOLEAN := FALSE;
BEGIN
  BEGIN PERFORM public.create_captain_vessel('Not allowed');
  EXCEPTION WHEN raise_exception THEN blocked := TRUE; END;
  IF NOT blocked THEN RAISE EXCEPTION 'New Crew created vessel'; END IF;
  blocked := FALSE;
  BEGIN UPDATE public.users SET vessel_creation_unlocked = TRUE WHERE id = auth.uid();
  EXCEPTION WHEN raise_exception THEN blocked := TRUE; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Crew forged eligibility'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
DO $$ DECLARE blocked BOOLEAN := FALSE;
BEGIN
  BEGIN PERFORM public.create_captain_vessel('Still attached');
  EXCEPTION WHEN raise_exception THEN blocked := TRUE; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Attached Captain created second vessel'; END IF;
  blocked := FALSE;
  BEGIN UPDATE public.users SET vessel_creation_unlocked = TRUE
    WHERE id = '20000000-0000-0000-0000-000000000002';
  EXCEPTION WHEN raise_exception THEN blocked := TRUE; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Captain forged someone else eligibility'; END IF;
END $$;
SELECT public.remove_current_vessel_crew_member('20000000-0000-0000-0000-000000000002');

SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
DO $$ DECLARE private_id UUID; new_id UUID; blocked BOOLEAN := FALSE;
BEGIN
  SELECT vessel_id INTO private_id FROM public.users WHERE id = auth.uid()
    AND role = 'CREW' AND vessel_creation_unlocked AND NOT paused
    AND department_2 IS NULL AND contract_type = 'permanent' AND rotation_group_id IS NULL;
  IF private_id IS NULL THEN RAISE EXCEPTION 'Removed HOD did not reset'; END IF;
  IF public.current_user_can_access_vessel('10000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Old vessel access retained'; END IF;
  IF (SELECT count(*) FROM public.sea_mile_entries) <> 1 THEN RAISE EXCEPTION 'Sea Miles lost'; END IF;
  IF EXISTS (SELECT 1 FROM public.notes) THEN RAISE EXCEPTION 'Old notes leaked'; END IF;
  -- Device rejection leaves the departure permission and private workspace intact.
  PERFORM set_config('test.device_allowed', 'no', true);
  BEGIN PERFORM public.create_captain_vessel('Unauthorized device');
  EXCEPTION WHEN raise_exception THEN blocked := TRUE; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Unauthorized device created vessel'; END IF;
  PERFORM set_config('test.device_allowed', 'yes', true);
  new_id := (public.create_captain_vessel('New vessel B')->>'id')::UUID;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'CAPTAIN_MOV'
    AND vessel_id = new_id AND NOT vessel_creation_unlocked) THEN RAISE EXCEPTION 'Creation did not assign Captain'; END IF;
  IF new_id = private_id THEN RAISE EXCEPTION 'Reused private records for shared vessel'; END IF;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
-- Promote the remaining Crew, then original Captain can depart and create again.
UPDATE public.users SET role = 'CAPTAIN_MOV' WHERE id = '20000000-0000-0000-0000-000000000003';
SELECT public.admin_leave_current_vessel('20000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'CREW' AND vessel_creation_unlocked) THEN
    RAISE EXCEPTION 'Former Captain did not reset to Crew'; END IF;
END $$;
SELECT public.create_captain_vessel('Former Captain new vessel');
-- Existing new-Captain signup behaviour is unchanged.
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000005', true);
SELECT public.create_captain_vessel('New Captain vessel');
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.notes) <> 1 THEN RAISE EXCEPTION 'Vessel records deleted'; END IF;
  IF (SELECT count(*) FROM public.sea_mile_entries) <> 1 THEN RAISE EXCEPTION 'Sea Miles deleted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vessels WHERE name = 'Shared A') THEN RAISE EXCEPTION 'Old vessel deleted'; END IF;
  IF has_function_privilege('authenticated', 'public.reset_departed_vessel_user(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.admin_leave_current_vessel(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.create_captain_vessel(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Private transition exposed'; END IF;
END $$;
ROLLBACK;
SELECT 'Vessel departure and creation tests passed' AS result;
