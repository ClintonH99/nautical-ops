-- Minimal Supabase-compatible storage/auth surface for disposable RLS tests.
-- This file is test scaffolding, not a production migration.

CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;

CREATE OR REPLACE FUNCTION storage.foldername(object_name TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[split_part(object_name, '/', 1)];
$$;

CREATE TABLE public.users (
  id UUID PRIMARY KEY,
  vessel_id UUID NOT NULL,
  role TEXT NOT NULL
);

CREATE OR REPLACE FUNCTION public.current_session_has_device_access()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$ SELECT TRUE $$;

CREATE TABLE storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public BOOLEAN NOT NULL DEFAULT FALSE,
  file_size_limit BIGINT,
  allowed_mime_types TEXT[]
);

CREATE TABLE storage.objects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket_id TEXT NOT NULL REFERENCES storage.buckets(id),
  name TEXT NOT NULL,
  UNIQUE (bucket_id, name)
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public, auth, storage TO authenticated;
GRANT SELECT ON public.users, storage.buckets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE storage.objects_id_seq TO authenticated;

INSERT INTO storage.buckets (id, name, public) VALUES
  ('profile-photos', 'profile-photos', TRUE),
  ('vessel-banners', 'vessel-banners', TRUE);
