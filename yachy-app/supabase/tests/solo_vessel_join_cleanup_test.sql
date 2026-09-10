\set ON_ERROR_STOP on

-- Minimal dependency stubs for exercising the production join migration in an
-- isolated disposable PostgreSQL database.
CREATE SCHEMA IF NOT EXISTS auth;

ALTER TABLE public.vessels
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS rotation_group_id UUID,
ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE;

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

CREATE OR REPLACE FUNCTION public.validate_vessel_invite_code(p_invite_code TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object('id', vessel.id, 'name', vessel.name)
  FROM public.vessels AS vessel
  WHERE vessel.invite_code = upper(trim(p_invite_code));
$$;

\ir ../migrations/20260910170000_CLEAN_UP_SOLO_VESSEL_ON_JOIN.sql

DO $$
DECLARE
  private_vessel UUID := '10000000-0000-0000-0000-000000000001';
  target_vessel UUID := '10000000-0000-0000-0000-000000000002';
  joining_crew UUID := '20000000-0000-0000-0000-000000000001';
BEGIN
  INSERT INTO public.vessels (id, name, invite_code, invite_expiry, is_solo)
  VALUES
    (private_vessel, 'Crew Account', 'SOLOJOIN0001', now() + INTERVAL '1 year', TRUE),
    (target_vessel, 'Real Vessel', 'JOINTEST0001', now() + INTERVAL '1 year', FALSE);
  INSERT INTO public.users (id, vessel_id, role, rotation_group_id, paused)
  VALUES (
    joining_crew,
    private_vessel,
    'CREW',
    '30000000-0000-0000-0000-000000000001',
    TRUE
  );

  PERFORM set_config('request.jwt.claim.sub', joining_crew::TEXT, true);
  PERFORM public.join_current_user_to_vessel('JOINTEST0001');

  IF (SELECT vessel_id FROM public.users WHERE id = joining_crew) <> target_vessel THEN
    RAISE EXCEPTION 'Crew account did not join the target vessel';
  END IF;
  IF (SELECT rotation_group_id FROM public.users WHERE id = joining_crew) IS NOT NULL THEN
    RAISE EXCEPTION 'Old-vessel rotation group remained after join';
  END IF;
  IF (SELECT paused FROM public.users WHERE id = joining_crew) THEN
    RAISE EXCEPTION 'Crew member remained paused after joining a new vessel';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vessels WHERE id = private_vessel) THEN
    RAISE EXCEPTION 'Empty private Crew Account vessel was not deleted after join';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vessels WHERE id = target_vessel) THEN
    RAISE EXCEPTION 'Target vessel was incorrectly deleted during join cleanup';
  END IF;
END;
$$;

DO $$
DECLARE
  occupied_private_vessel UUID := '10000000-0000-0000-0000-000000000003';
  target_vessel UUID := '10000000-0000-0000-0000-000000000004';
  joining_crew UUID := '20000000-0000-0000-0000-000000000002';
  remaining_crew UUID := '20000000-0000-0000-0000-000000000003';
BEGIN
  INSERT INTO public.vessels (id, name, invite_code, invite_expiry, is_solo)
  VALUES
    (occupied_private_vessel, 'Crew Account', 'SOLOJOIN0002', now() + INTERVAL '1 year', TRUE),
    (target_vessel, 'Second Real Vessel', 'JOINTEST0002', now() + INTERVAL '1 year', FALSE);
  INSERT INTO public.users (id, vessel_id, role)
  VALUES
    (joining_crew, occupied_private_vessel, 'CREW'),
    (remaining_crew, occupied_private_vessel, 'CREW');

  PERFORM set_config('request.jwt.claim.sub', joining_crew::TEXT, true);
  PERFORM public.join_current_user_to_vessel('JOINTEST0002');

  IF NOT EXISTS (SELECT 1 FROM public.vessels WHERE id = occupied_private_vessel) THEN
    RAISE EXCEPTION 'An occupied private workspace was incorrectly deleted';
  END IF;
  IF (SELECT vessel_id FROM public.users WHERE id = remaining_crew) <> occupied_private_vessel THEN
    RAISE EXCEPTION 'The remaining Crew member was moved or detached';
  END IF;
END;
$$;

SELECT 'solo vessel join cleanup tests passed' AS result;
