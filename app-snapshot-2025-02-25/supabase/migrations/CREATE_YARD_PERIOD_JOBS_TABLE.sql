-- Yard Period Jobs table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.yard_period_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  job_title TEXT NOT NULL,
  job_description TEXT,
  yard_location TEXT,
  contractor_company_name TEXT,
  contact_details TEXT,
  done_by_date DATE,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),
  completed_by UUID REFERENCES auth.users(id),
  completed_at TIMESTAMPTZ,
  completed_by_name TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yard_period_jobs_vessel_id ON public.yard_period_jobs(vessel_id);
CREATE INDEX IF NOT EXISTS idx_yard_period_jobs_done_by ON public.yard_period_jobs(done_by_date) WHERE done_by_date IS NOT NULL;

ALTER TABLE public.yard_period_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vessel members can manage yard period jobs"
  ON public.yard_period_jobs
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.yard_period_jobs IS 'Yard period jobs with contractor and location details';
