-- Add rotation_group_id to users table
-- Crew members sharing the same rotation_group_id UUID are linked as rotation partners

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS rotation_group_id UUID DEFAULT NULL;
