-- =============================================================================
-- FIX: "Could not find the 'department_2' column" error when creating crew
-- =============================================================================
-- Copy everything below (from ALTER to the semicolon) and paste it into
-- Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS department_2 TEXT
  CHECK (department_2 IS NULL OR department_2 IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'));
