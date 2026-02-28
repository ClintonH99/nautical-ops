-- Add department to contractors
-- Run in Supabase SQL Editor after CREATE_CONTRACTORS_TABLE.sql

ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT 'INTERIOR'
  CHECK (department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'));

CREATE INDEX IF NOT EXISTS idx_contractors_department ON public.contractors(department);

COMMENT ON COLUMN public.contractors.department IS 'Department the contractor is assigned to';
