-- Add contract_type column to profiles table
-- Supports: permanent (default/no badge), temporary (TEMP badge), rotational (Rotation badge)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contract_type TEXT NOT NULL DEFAULT 'permanent'
  CHECK (contract_type IN ('permanent', 'temporary', 'rotational'));
