-- Add known_for to contractors (keywords for search)
-- Run in Supabase SQL Editor after ADD_CONTRACTOR_DEPARTMENT.sql

ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS known_for TEXT;

COMMENT ON COLUMN public.contractors.known_for IS 'Keywords describing what the contractor does (plumbing, electrical, etc) - used for keyword search';
