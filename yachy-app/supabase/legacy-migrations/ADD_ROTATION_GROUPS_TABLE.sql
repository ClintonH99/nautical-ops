-- HISTORICAL SCRIPT: retained for reference; do not run as an active migration.
-- Create rotation_groups table for named rotation groups
-- Users reference this table via their rotation_group_id column

CREATE TABLE IF NOT EXISTS public.rotation_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
