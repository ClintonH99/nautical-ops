-- Fix profile photo upload RLS for crew members
-- Issue: "new row violates row-level security policy" when crew upload photos
-- Cause: Need SELECT+UPDATE for upsert, and use "to authenticated" syntax
-- Run in Supabase SQL Editor if not using migrations

-- Drop existing policies (names may vary)
DROP POLICY IF EXISTS "Anyone can view profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own profile photos" ON storage.objects;

-- Create profile-photos bucket if missing
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Allow public read (anyone can view profile photos)
CREATE POLICY "Profile photos public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'profile-photos');

-- Allow authenticated users (including crew) to upload
CREATE POLICY "Profile photos authenticated upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'profile-photos');

-- Allow authenticated users to update (required for upsert)
CREATE POLICY "Profile photos authenticated update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'profile-photos')
WITH CHECK (bucket_id = 'profile-photos');

-- Allow authenticated users to delete their uploads
CREATE POLICY "Profile photos authenticated delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'profile-photos');
