-- Disposable PostgreSQL only: production safety_equipment policies + new migration.
BEGIN;
INSERT INTO public.vessels(id, name, invite_code) VALUES
 ('10000000-0000-0000-0000-000000000001', 'Safety vessel', 'SAFE1'),
 ('10000000-0000-0000-0000-000000000002', 'Other vessel', 'SAFE2');
INSERT INTO public.users(id, vessel_id, role) VALUES
 ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'CREW'),
 ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'HOD'),
 ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'CAPTAIN_MOV'),
 ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'MANAGEMENT'),
 ('20000000-0000-0000-0000-000000000005', NULL, 'CREW');
INSERT INTO public.safety_equipment(id, vessel_id, title, data) VALUES
 ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Existing shared plan', '{}'),
 ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Other vessel plan', '{}');
SET LOCAL ROLE authenticated;
DO $$
DECLARE actor RECORD; new_id UUID; affected INTEGER; blocked BOOLEAN;
BEGIN
  FOR actor IN SELECT * FROM (VALUES
    ('20000000-0000-0000-0000-000000000001'::UUID, 'CREW', TRUE),
    ('20000000-0000-0000-0000-000000000002'::UUID, 'HOD', TRUE),
    ('20000000-0000-0000-0000-000000000003'::UUID, 'CAPTAIN_MOV', TRUE),
    ('20000000-0000-0000-0000-000000000004'::UUID, 'MANAGEMENT', FALSE),
    ('20000000-0000-0000-0000-000000000005'::UUID, 'DETACHED_CREW', FALSE)
  ) AS actors(id, role, can_edit) LOOP
    PERFORM set_config('request.jwt.claim.sub', actor.id::TEXT, TRUE);
    blocked := FALSE;
    BEGIN
      INSERT INTO public.safety_equipment(vessel_id, title, data)
      VALUES ('10000000-0000-0000-0000-000000000001', 'New', '{}') RETURNING id INTO new_id;
    EXCEPTION WHEN insufficient_privilege THEN blocked := TRUE;
    END;
    IF blocked = actor.can_edit THEN RAISE EXCEPTION 'Wrong INSERT permission: %', actor.role; END IF;

    UPDATE public.safety_equipment SET title = actor.role
    WHERE id = '30000000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF (affected = 1) <> actor.can_edit THEN RAISE EXCEPTION 'Wrong UPDATE permission: %', actor.role; END IF;

    DELETE FROM public.safety_equipment WHERE id = new_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF (affected = 1) <> (actor.role IN ('HOD', 'CAPTAIN_MOV')) THEN
      RAISE EXCEPTION 'DELETE permission changed: %', actor.role;
    END IF;
    new_id := NULL;

    UPDATE public.safety_equipment SET title = 'Cross-vessel'
    WHERE id = '30000000-0000-0000-0000-000000000002';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Cross-vessel UPDATE allowed'; END IF;
    blocked := FALSE;
    BEGIN
      INSERT INTO public.safety_equipment(vessel_id, title, data)
      VALUES ('10000000-0000-0000-0000-000000000002', 'Cross-vessel', '{}');
    EXCEPTION WHEN insufficient_privilege THEN blocked := TRUE;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Cross-vessel INSERT allowed'; END IF;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', TRUE);
  blocked := FALSE;
  BEGIN
    UPDATE public.safety_equipment SET vessel_id = '10000000-0000-0000-0000-000000000002'
    WHERE id = '30000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN insufficient_privilege THEN blocked := TRUE;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Crew moved a plan to another vessel'; END IF;

  -- Access restrictions must still block Crew writes.
  PERFORM set_config('test.device_allowed', 'no', TRUE);
  UPDATE public.safety_equipment SET title = 'Blocked device'
  WHERE id = '30000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Device access restriction bypassed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Crew Safety Equipment RLS tests passed' AS result;
