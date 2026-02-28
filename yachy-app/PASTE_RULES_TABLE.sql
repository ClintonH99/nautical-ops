-- Copy everything below this line and paste into Supabase SQL Editor, then click Run
-- This creates the rules table for the Rules On-Board feature

CREATE TABLE IF NOT EXISTS public.rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_rules_vessel ON public.rules(vessel_id);
CREATE INDEX IF NOT EXISTS idx_rules_created ON public.rules(created_at DESC);

ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vessel members can view and manage rules"
  ON public.rules FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.rules IS 'Published general rules for all crew to conform to';
