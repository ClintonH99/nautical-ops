-- Add completed_by tracking and recurring to vessel_tasks
-- Run this in Supabase SQL Editor after CREATE_VESSEL_TASKS_TABLE

ALTER TABLE public.vessel_tasks
  ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS recurring TEXT CHECK (recurring IN ('7_DAYS', '14_DAYS', '30_DAYS'));
