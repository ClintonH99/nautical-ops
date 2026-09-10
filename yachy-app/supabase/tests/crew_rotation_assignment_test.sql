\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS auth;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS contract_type TEXT NOT NULL DEFAULT 'permanent',
ADD COLUMN IF NOT EXISTS rotation_group_id UUID;

CREATE TABLE public.watch_keepers (
  vessel_id UUID NOT NULL,
  user_id UUID NOT NULL
);

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

CREATE OR REPLACE FUNCTION public.current_user_is_captain_of(target_vessel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND vessel_id = target_vessel_id
      AND role = 'CAPTAIN_MOV'
  );
$$;

\ir ../migrations/20260910180000_REMOVE_WATCH_KEEPERS_ADD_CREW_ROTATION.sql

DO $$
DECLARE
  vessel UUID := '10000000-0000-0000-0000-000000000001';
  other_vessel UUID := '10000000-0000-0000-0000-000000000002';
  captain UUID := '20000000-0000-0000-0000-000000000001';
  crew UUID := '20000000-0000-0000-0000-000000000002';
  outsider UUID := '20000000-0000-0000-0000-000000000003';
  blocked BOOLEAN := FALSE;
BEGIN
  INSERT INTO public.vessels (id, name, invite_code, is_solo)
  VALUES
    (vessel, 'Rotation Test', 'ROTATION0001', FALSE),
    (other_vessel, 'Other Vessel', 'ROTATION0002', FALSE);
  INSERT INTO public.users (id, vessel_id, role, contract_type, rotation_group_id)
  VALUES
    (captain, vessel, 'CAPTAIN_MOV', 'permanent', gen_random_uuid()),
    (crew, vessel, 'CREW', 'temporary', gen_random_uuid()),
    (outsider, other_vessel, 'CREW', 'permanent', NULL);

  PERFORM set_config('request.jwt.claim.sub', captain::TEXT, true);
  PERFORM public.assign_current_vessel_crew_rotation(captain);
  PERFORM public.assign_current_vessel_crew_rotation(crew);

  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE id IN (captain, crew)
      AND (contract_type <> 'rotational' OR rotation_group_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Captain could not assign every onboard role to rotation';
  END IF;

  BEGIN
    PERFORM public.assign_current_vessel_crew_rotation(outsider);
  EXCEPTION WHEN OTHERS THEN
    blocked := TRUE;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'Captain assigned a user from another vessel';
  END IF;

  blocked := FALSE;
  PERFORM set_config('request.jwt.claim.sub', crew::TEXT, true);
  BEGIN
    PERFORM public.assign_current_vessel_crew_rotation(captain);
  EXCEPTION WHEN OTHERS THEN
    blocked := TRUE;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'A non-Captain assigned a crew rotation';
  END IF;

  IF to_regclass('public.watch_keepers') IS NOT NULL THEN
    RAISE EXCEPTION 'Obsolete Watch Keeper table still exists';
  END IF;
END;
$$;

SELECT 'crew rotation assignment tests passed' AS result;
