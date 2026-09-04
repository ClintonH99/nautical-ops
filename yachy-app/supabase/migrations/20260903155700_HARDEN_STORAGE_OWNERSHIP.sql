-- Timestamped migration: restrict public image-bucket writes to the account/vessel represented by the
-- first folder in the object path. Public buckets remain readable by URL, but
-- ordinary authenticated users cannot overwrite another account's assets.

UPDATE storage.buckets
SET file_size_limit = 10485760
WHERE id IN ('profile-photos', 'vessel-banners');

-- Keep storage policies independent of the RLS rules on public.users. These
-- helpers only answer whether the signed-in user belongs to (or captains) the
-- vessel represented by the first folder in a storage object path.
CREATE OR REPLACE FUNCTION public.current_user_can_access_vessel_storage_path(
  p_vessel_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS current_user_row
    WHERE current_user_row.id = auth.uid()
      AND current_user_row.vessel_id::TEXT = p_vessel_id
  )
  AND public.current_session_has_device_access();
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_captain_for_storage_path(
  p_vessel_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS current_user_row
    WHERE current_user_row.id = auth.uid()
      AND current_user_row.role = 'CAPTAIN_MOV'
      AND current_user_row.vessel_id::TEXT = p_vessel_id
  )
  AND public.current_session_has_device_access();
$$;

REVOKE ALL ON FUNCTION public.current_user_can_access_vessel_storage_path(TEXT)
FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_is_captain_for_storage_path(TEXT)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_vessel_storage_path(TEXT)
TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_is_captain_for_storage_path(TEXT)
TO authenticated, service_role;

DROP POLICY IF EXISTS "Anyone can view profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Profile photos public read" ON storage.objects;
DROP POLICY IF EXISTS "Profile photos authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS "Profile photos authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "Profile photos authenticated delete" ON storage.objects;

CREATE POLICY "Profile photos authenticated read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'profile-photos');

CREATE POLICY "Users upload their own profile photo"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
  AND public.current_session_has_device_access()
);

CREATE POLICY "Users update their own profile photo"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
  AND public.current_session_has_device_access()
)
WITH CHECK (
  bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
  AND public.current_session_has_device_access()
);

CREATE POLICY "Users delete their own profile photo"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
  AND public.current_session_has_device_access()
);

DROP POLICY IF EXISTS "Anyone can view vessel banners" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload vessel banners" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update vessel banners" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete vessel banners" ON storage.objects;

CREATE POLICY "Vessel members read vessel banners"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'vessel-banners'
  AND public.current_user_can_access_vessel_storage_path(
    (storage.foldername(name))[1]
  )
);

CREATE POLICY "Captains upload their vessel banner"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'vessel-banners'
  AND public.current_user_is_captain_for_storage_path(
    (storage.foldername(name))[1]
  )
);

CREATE POLICY "Captains update their vessel banner"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'vessel-banners'
  AND public.current_user_is_captain_for_storage_path(
    (storage.foldername(name))[1]
  )
)
WITH CHECK (
  bucket_id = 'vessel-banners'
  AND public.current_user_is_captain_for_storage_path(
    (storage.foldername(name))[1]
  )
);

CREATE POLICY "Captains delete their vessel banner"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'vessel-banners'
  AND public.current_user_is_captain_for_storage_path(
    (storage.foldername(name))[1]
  )
);
