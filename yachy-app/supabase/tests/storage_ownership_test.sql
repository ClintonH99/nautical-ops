\set ON_ERROR_STOP on

INSERT INTO public.users (id, vessel_id, role) VALUES
  ('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'CAPTAIN_MOV'),
  ('40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'CREW'),
  ('40000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', 'CAPTAIN_MOV');

INSERT INTO storage.objects (bucket_id, name) VALUES
  ('profile-photos', '40000000-0000-0000-0000-000000000001/avatar.jpg'),
  ('profile-photos', '40000000-0000-0000-0000-000000000002/avatar.jpg'),
  ('vessel-banners', '50000000-0000-0000-0000-000000000001/banner.jpg'),
  ('vessel-banners', '50000000-0000-0000-0000-000000000002/banner.jpg');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000002', false);

DO $$
DECLARE
  changed_rows INTEGER;
BEGIN
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('profile-photos', '40000000-0000-0000-0000-000000000002/new-avatar.jpg');

  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('profile-photos', '40000000-0000-0000-0000-000000000001/intruder.jpg');
    RAISE EXCEPTION 'Crew member uploaded another user profile photo';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('vessel-banners', '50000000-0000-0000-0000-000000000001/crew.jpg');
    RAISE EXCEPTION 'Crew member uploaded a vessel banner';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  DELETE FROM storage.objects
  WHERE bucket_id = 'profile-photos'
    AND name = '40000000-0000-0000-0000-000000000001/avatar.jpg';
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 0 THEN RAISE EXCEPTION 'Crew member deleted another profile photo'; END IF;

  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'vessel-banners') <> 1 THEN
    RAISE EXCEPTION 'Crew member can read another vessel banner through the authenticated API';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', false);

DO $$
DECLARE
  changed_rows INTEGER;
BEGIN
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('vessel-banners', '50000000-0000-0000-0000-000000000001/captain.jpg');

  DELETE FROM storage.objects
  WHERE bucket_id = 'vessel-banners'
    AND name = '50000000-0000-0000-0000-000000000002/banner.jpg';
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 0 THEN RAISE EXCEPTION 'Captain deleted another vessel banner'; END IF;

  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'vessel-banners') <> 2 THEN
    RAISE EXCEPTION 'Captain authenticated reads escaped their vessel';
  END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname IN (
        'Authenticated users can upload vessel banners',
        'Authenticated users can update vessel banners',
        'Authenticated users can delete vessel banners',
        'Profile photos authenticated upload',
        'Profile photos authenticated update',
        'Profile photos authenticated delete'
      )
  ) THEN
    RAISE EXCEPTION 'A broad legacy storage policy still exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id IN ('profile-photos', 'vessel-banners')
      AND file_size_limit IS DISTINCT FROM 10485760
  ) THEN
    RAISE EXCEPTION 'Image bucket size limit was not applied';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.current_user_can_access_vessel_storage_path(text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.current_user_is_captain_for_storage_path(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anonymous role can execute a storage ownership helper';
  END IF;
END;
$$;

SELECT 'storage ownership tests passed' AS result;
