-- =============================================================================
-- FIX: Profile photo upload fails for crew ("new row violates row-level security")
-- =============================================================================
-- Copy everything below and paste into Supabase Dashboard → SQL Editor → Run
-- =============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own profile photos" ON storage.objects;

-- Ensure bucket exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read
CREATE POLICY "Profile photos public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'profile-photos');

-- Authenticated upload (crew + captains)
CREATE POLICY "Profile photos authenticated upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'profile-photos');

-- Authenticated update (required for upsert)
CREATE POLICY "Profile photos authenticated update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'profile-photos')
WITH CHECK (bucket_id = 'profile-photos');

-- Authenticated delete
CREATE POLICY "Profile photos authenticated delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'profile-photos');
