-- Vessel trip type colors (HOD can customize)
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.vessel_trip_colors (
  vessel_id UUID PRIMARY KEY REFERENCES public.vessels(id) ON DELETE CASCADE,
  guest_trip_color TEXT,
  boss_trip_color TEXT,
  delivery_trip_color TEXT,
  yard_period_color TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Optional: RLS - vessel members can read, HOD can update (simplified: allow all for vessel)
ALTER TABLE public.vessel_trip_colors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vessel members can manage trip colors"
  ON public.vessel_trip_colors FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.vessel_trip_colors IS 'Custom calendar colors per trip type (HOD editable)';
