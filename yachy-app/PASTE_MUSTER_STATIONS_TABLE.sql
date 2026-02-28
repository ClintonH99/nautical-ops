-- Copy everything below this line and paste into Supabase SQL Editor, then click Run
-- This creates the muster_stations table for Muster Station & Duties

CREATE TABLE IF NOT EXISTS public.muster_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_muster_stations_vessel ON public.muster_stations(vessel_id);
CREATE INDEX IF NOT EXISTS idx_muster_stations_created ON public.muster_stations(created_at DESC);

ALTER TABLE public.muster_stations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vessel members can view and manage muster stations"
  ON public.muster_stations FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.muster_stations IS 'Published muster station plans - vessel crew can view and download';
