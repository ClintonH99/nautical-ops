BEGIN;
INSERT INTO public.vessels(id, name, invite_code, is_solo) VALUES
 ('10000000-0000-0000-0000-000000000001', 'Shared', 'WATCH1', FALSE),
 ('10000000-0000-0000-0000-000000000002', 'Personal', 'WATCH2', TRUE),
 ('10000000-0000-0000-0000-000000000003', 'Other personal', 'WATCH3', TRUE);
INSERT INTO public.users(id, vessel_id, role) VALUES
 ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'CREW'),
 ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'HOD'),
 ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'CAPTAIN_MOV'),
 ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'CREW'),
 ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'MANAGEMENT');
SET LOCAL ROLE authenticated;
DO $$
DECLARE actor RECORD; blocked BOOLEAN; own_vessel UUID;
BEGIN
  FOR actor IN SELECT * FROM (VALUES
    ('20000000-0000-0000-0000-000000000001'::UUID, FALSE),
    ('20000000-0000-0000-0000-000000000002'::UUID, TRUE),
    ('20000000-0000-0000-0000-000000000003'::UUID, TRUE),
    ('20000000-0000-0000-0000-000000000004'::UUID, TRUE),
    ('20000000-0000-0000-0000-000000000005'::UUID, FALSE)
  ) AS actors(id, allowed) LOOP
    PERFORM set_config('request.jwt.claim.sub', actor.id::TEXT, TRUE);
    SELECT vessel_id INTO own_vessel FROM public.users WHERE id = actor.id;
    blocked := FALSE;
    BEGIN
      INSERT INTO public.watch_keeping_timetables(vessel_id, watch_title, start_time, slots, created_by)
      VALUES (own_vessel, 'Test schedule', '06:00', '[]', actor.id);
    EXCEPTION WHEN insufficient_privilege THEN blocked := TRUE;
    END;
    IF blocked = actor.allowed THEN RAISE EXCEPTION 'Incorrect create access for %', actor.id; END IF;
    blocked := FALSE;
    BEGIN
      INSERT INTO public.watch_keeping_timetables(vessel_id, watch_title, start_time, slots, created_by)
      VALUES ('10000000-0000-0000-0000-000000000003', 'Other workspace', '06:00', '[]', actor.id);
    EXCEPTION WHEN insufficient_privilege THEN blocked := TRUE;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Cross-workspace INSERT allowed'; END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000004', TRUE);
  blocked := FALSE;
  BEGIN
    INSERT INTO public.watch_keeping_timetables(vessel_id, watch_title, start_time, slots, created_by)
    VALUES ('10000000-0000-0000-0000-000000000002', 'Forged author', '06:00', '[]', '20000000-0000-0000-0000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN blocked := TRUE;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Personal author spoofing allowed'; END IF;
END $$;
RESET ROLE;
-- Joining a shared vessel immediately removes the personal creation exception.
UPDATE public.users SET vessel_id = '10000000-0000-0000-0000-000000000001'
WHERE id = '20000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
DO $$
DECLARE target UUID; blocked BOOLEAN;
BEGIN
  FOREACH target IN ARRAY ARRAY['10000000-0000-0000-0000-000000000001'::UUID, '10000000-0000-0000-0000-000000000002'::UUID] LOOP
    blocked := FALSE;
    BEGIN
      INSERT INTO public.watch_keeping_timetables(vessel_id, watch_title, start_time, slots, created_by)
      VALUES (target, 'After joining', '06:00', '[]', auth.uid());
    EXCEPTION WHEN insufficient_privilege THEN blocked := TRUE;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Personal permission survived joining'; END IF;
  END LOOP;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Personal watch schedule RLS tests passed' AS result;
