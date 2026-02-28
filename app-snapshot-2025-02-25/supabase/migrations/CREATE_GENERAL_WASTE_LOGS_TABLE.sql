-- General Waste Logs Table
-- Stores vessel garbage/waste disposal log entries

CREATE TABLE IF NOT EXISTS public.general_waste_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id             UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  log_date              DATE NOT NULL,
  log_time              TEXT NOT NULL,
  position_location     TEXT,
  description_of_garbage TEXT,
  created_by_name       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast per-vessel queries ordered by date
CREATE INDEX IF NOT EXISTS idx_general_waste_logs_vessel_date
  ON public.general_waste_logs(vessel_id, log_date DESC);

-- Row Level Security
ALTER TABLE public.general_waste_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/write logs for their own vessel
CREATE POLICY "vessel_members_all" ON public.general_waste_logs
  FOR ALL
  USING (
    vessel_id IN (
      SELECT vessel_id FROM public.users WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    vessel_id IN (
      SELECT vessel_id FROM public.users WHERE id = auth.uid()
    )
  );
