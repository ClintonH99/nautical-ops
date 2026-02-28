-- Vessel Tasks table for Daily, Weekly, Monthly tasks
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.vessel_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  title TEXT NOT NULL,
  notes TEXT,
  done_by_date DATE,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),
  recurring TEXT CHECK (recurring IN ('7_DAYS', '14_DAYS', '30_DAYS')),
  completed_by UUID REFERENCES auth.users(id),
  completed_at TIMESTAMPTZ,
  completed_by_name TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vessel_tasks_vessel_id ON public.vessel_tasks(vessel_id);
CREATE INDEX IF NOT EXISTS idx_vessel_tasks_category ON public.vessel_tasks(vessel_id, category);
CREATE INDEX IF NOT EXISTS idx_vessel_tasks_done_by ON public.vessel_tasks(done_by_date) WHERE done_by_date IS NOT NULL;

ALTER TABLE public.vessel_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vessel members can manage tasks"
  ON public.vessel_tasks
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.vessel_tasks IS 'Daily, Weekly, Monthly tasks for vessel operations';
