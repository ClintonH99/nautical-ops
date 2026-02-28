-- =============================================
-- Supabase Storage Setup for Profile Photos
-- =============================================
-- Run this in Supabase SQL Editor to set up profile photo storage
-- Date: February 16, 2026

-- =============================================
-- 1. Create Storage Bucket
-- =============================================

-- Create the profile-photos bucket (if it doesn't exist)
-- Note: You can also create this via Supabase Dashboard > Storage > New Bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 2. Storage Policies
-- =============================================

-- Allow anyone to view profile photos (public read)
CREATE POLICY "Anyone can view profile photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'profile-photos');

-- Allow authenticated users to upload profile photos
CREATE POLICY "Authenticated users can upload profile photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'profile-photos' 
  AND auth.role() = 'authenticated'
);

-- Allow users to update their own profile photos
CREATE POLICY "Users can update their own profile photos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'profile-photos' 
  AND auth.role() = 'authenticated'
);

-- Allow users to delete their own profile photos
CREATE POLICY "Users can delete their own profile photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'profile-photos' 
  AND auth.role() = 'authenticated'
);

-- =============================================
-- Verification Queries
-- =============================================

-- Verify bucket was created
SELECT * FROM storage.buckets WHERE id = 'profile-photos';

-- Verify policies were created
SELECT * FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';

-- =============================================
-- Manual Setup Instructions (Alternative)
-- =============================================

/*
If you prefer to set up via Supabase Dashboard:

1. Go to Supabase Dashboard → Storage
2. Click "New bucket"
3. Enter details:
   - Name: profile-photos
   - Public bucket: YES (toggle ON)
   - File size limit: (optional, e.g., 5MB)
   - Allowed MIME types: (optional, e.g., image/jpeg, image/png)
4. Click "Create bucket"
5. Policies will be automatically created for public read

Note: The SQL policies above provide more granular control
*/

-- =============================================
-- Cleanup (if needed)
-- =============================================

/*
-- To remove all policies and bucket:
DROP POLICY IF EXISTS "Anyone can view profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own profile photos" ON storage.objects;

DELETE FROM storage.buckets WHERE id = 'profile-photos';
*/
