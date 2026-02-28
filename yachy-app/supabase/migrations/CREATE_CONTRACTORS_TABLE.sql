-- Contractors (per vessel)
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  company_address TEXT,
  description TEXT,
  contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_contractors_vessel_id ON public.contractors(vessel_id);

ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vessel members can manage contractors"
  ON public.contractors
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.contractors IS 'Contractor database: company info and contact persons (name, mobile, email per contact)';
