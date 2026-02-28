-- =============================================
-- Vessel Banner Storage Setup
-- =============================================
-- Copy everything below and paste into Supabase SQL Editor, then click Run.
-- This creates the vessel-banners bucket and policies via SQL (more reliable than Dashboard).

-- =============================================
-- 1. Create Storage Bucket
-- =============================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('vessel-banners', 'vessel-banners', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- =============================================
-- 2. Storage Policies
-- =============================================

-- Allow public read (anyone can view vessel banners)
DROP POLICY IF EXISTS "Anyone can view vessel banners" ON storage.objects;
CREATE POLICY "Anyone can view vessel banners"
ON storage.objects FOR SELECT
USING (bucket_id = 'vessel-banners');

-- Allow authenticated users (crew) to upload vessel banners
DROP POLICY IF EXISTS "Authenticated users can upload vessel banners" ON storage.objects;
CREATE POLICY "Authenticated users can upload vessel banners"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'vessel-banners'
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to update vessel banners
DROP POLICY IF EXISTS "Authenticated users can update vessel banners" ON storage.objects;
CREATE POLICY "Authenticated users can update vessel banners"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'vessel-banners'
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to delete vessel banners
DROP POLICY IF EXISTS "Authenticated users can delete vessel banners" ON storage.objects;
CREATE POLICY "Authenticated users can delete vessel banners"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'vessel-banners'
  AND auth.role() = 'authenticated'
);
