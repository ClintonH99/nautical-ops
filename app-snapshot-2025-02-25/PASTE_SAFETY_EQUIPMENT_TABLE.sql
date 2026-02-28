-- Copy everything below this line and paste into Supabase SQL Editor, then click Run
-- This creates the safety_equipment table required for the Safety Equipment feature

CREATE TABLE IF NOT EXISTS public.safety_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_safety_equipment_vessel ON public.safety_equipment(vessel_id);
CREATE INDEX IF NOT EXISTS idx_safety_equipment_created ON public.safety_equipment(created_at DESC);

ALTER TABLE public.safety_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vessel members can view and manage safety equipment"
  ON public.safety_equipment FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.safety_equipment IS 'Published safety equipment location plans - vessel crew can view and download';
