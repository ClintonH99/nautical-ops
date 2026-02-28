-- Watch Keeping Timetables (Published)
-- Run this in Supabase SQL Editor
-- HODs publish timetables; crew can view on calendar

CREATE TABLE IF NOT EXISTS public.watch_keeping_timetables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  watch_title TEXT NOT NULL,
  start_time TEXT NOT NULL,
  start_location TEXT,
  destination TEXT,
  notes TEXT,
  for_date DATE NOT NULL,
  slots JSONB NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watch_timetables_vessel_id ON public.watch_keeping_timetables(vessel_id);
CREATE INDEX IF NOT EXISTS idx_watch_timetables_for_date ON public.watch_keeping_timetables(for_date);

ALTER TABLE public.watch_keeping_timetables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vessel members can manage watch timetables"
  ON public.watch_keeping_timetables
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.watch_keeping_timetables IS 'Published watch keeping timetables visible to crew on calendar';
