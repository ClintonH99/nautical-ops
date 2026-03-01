-- Tighten profile photos storage RLS: users can only upload/update/delete their own photo
-- Path format: {userId}/avatar.jpg - restrict so folder name must match auth.uid()

DROP POLICY IF EXISTS "Profile photos authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS "Profile photos authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "Profile photos authenticated delete" ON storage.objects;

-- Upload: only to own folder (first path segment = auth.uid())
CREATE POLICY "Profile photos authenticated upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Update: only own folder
CREATE POLICY "Profile photos authenticated update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Delete: only own folder
CREATE POLICY "Profile photos authenticated delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
