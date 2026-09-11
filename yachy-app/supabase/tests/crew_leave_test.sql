\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;

CREATE OR REPLACE FUNCTION public.current_session_has_device_access()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$ SELECT TRUE; $$;

\ir ../migrations/20260910190000_ADD_CREW_LEAVE.sql

INSERT INTO public.vessels (id, name, invite_code, invite_expiry, is_solo)
VALUES
  ('61000000-0000-0000-0000-000000000001', 'Leave Test Vessel', 'LEAVETEST001', now() + interval '1 year', FALSE),
  ('61000000-0000-0000-0000-000000000002', 'Other Leave Vessel', 'LEAVETEST002', now() + interval '1 year', FALSE);

INSERT INTO public.users (id, email, name, position, department, vessel_id, role)
VALUES
  ('62000000-0000-0000-0000-000000000001', 'captain@leave.test', 'Captain', 'Captain', 'BRIDGE', '61000000-0000-0000-0000-000000000001', 'CAPTAIN_MOV'),
  ('62000000-0000-0000-0000-000000000002', 'hod@leave.test', 'HOD', 'Chief Engineer', 'ENGINEERING', '61000000-0000-0000-0000-000000000001', 'HOD'),
  ('62000000-0000-0000-0000-000000000003', 'crew@leave.test', 'Crew', 'Deckhand', 'EXTERIOR', '61000000-0000-0000-0000-000000000001', 'CREW'),
  ('62000000-0000-0000-0000-000000000004', 'other@leave.test', 'Other Crew', 'Stewardess', 'INTERIOR', '61000000-0000-0000-0000-000000000002', 'CREW');

SET ROLE authenticated;

SELECT set_config('request.jwt.claim.sub', '62000000-0000-0000-0000-000000000001', false);

INSERT INTO public.crew_leave (
  id, vessel_id, crew_member_id, leave_type, start_date, end_date
)
VALUES (
  '63000000-0000-0000-0000-000000000001',
  '61000000-0000-0000-0000-000000000001',
  '62000000-0000-0000-0000-000000000003',
  'ANNUAL',
  '2026-09-14',
  '2026-09-21'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.crew_leave (
      vessel_id, crew_member_id, leave_type, start_date, end_date
    ) VALUES (
      '61000000-0000-0000-0000-000000000001',
      '62000000-0000-0000-0000-000000000004',
      'OTHER',
      '2026-09-20',
      '2026-09-21'
    );
    RAISE EXCEPTION 'Captain assigned leave to a user on another vessel';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.crew_leave (
      vessel_id, crew_member_id, leave_type, start_date, end_date
    ) VALUES (
      '61000000-0000-0000-0000-000000000001',
      '62000000-0000-0000-0000-000000000003',
      'SICK',
      '2026-09-21',
      '2026-09-20'
    );
    RAISE EXCEPTION 'Crew leave accepted an invalid date range';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '62000000-0000-0000-0000-000000000002', false);

UPDATE public.crew_leave
SET leave_type = 'ROTATION'
WHERE id = '63000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crew_leave
    WHERE id = '63000000-0000-0000-0000-000000000001'
      AND leave_type = 'ROTATION'
  ) THEN
    RAISE EXCEPTION 'HOD could not update onboard crew leave';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '62000000-0000-0000-0000-000000000003', false);

DO $$
DECLARE
  visible_rows INTEGER;
BEGIN
  SELECT count(*) INTO visible_rows FROM public.crew_leave;
  IF visible_rows <> 1 THEN
    RAISE EXCEPTION 'Onboard crew could not read vessel leave';
  END IF;

  BEGIN
    INSERT INTO public.crew_leave (
      vessel_id, crew_member_id, leave_type, start_date, end_date
    ) VALUES (
      '61000000-0000-0000-0000-000000000001',
      '62000000-0000-0000-0000-000000000003',
      'OTHER',
      '2026-10-01',
      '2026-10-02'
    );
    RAISE EXCEPTION 'Ordinary crew created crew leave';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '62000000-0000-0000-0000-000000000004', false);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.crew_leave) THEN
    RAISE EXCEPTION 'A user from another vessel read crew leave';
  END IF;
END;
$$;

RESET ROLE;

SELECT 'crew leave tests passed' AS result;
