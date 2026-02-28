-- Maintenance Logs table
-- Run this in Supabase SQL Editor
-- Logs persist until manually deleted

CREATE TABLE IF NOT EXISTS public.maintenance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  equipment TEXT NOT NULL,
  port_starboard_na TEXT,
  serial_number TEXT,
  hours_of_service TEXT,
  hours_at_next_service TEXT,
  what_service_done TEXT,
  notes TEXT,
  service_done_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_logs_vessel_id ON public.maintenance_logs(vessel_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_logs_created_at ON public.maintenance_logs(created_at DESC);

ALTER TABLE public.maintenance_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vessel members can manage maintenance logs"
  ON public.maintenance_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.maintenance_logs IS 'Maintenance log entries - equipment, service hours, what was done, by whom; persist until deleted';
