-- Pump Out Logs Table
-- Stores vessel sewage/waste pump out log entries

CREATE TABLE IF NOT EXISTS public.pump_out_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id             UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  discharge_type        TEXT NOT NULL CHECK (discharge_type IN ('DIRECT_DISCHARGE', 'TREATMENT_PLANT', 'PUMPOUT_SERVICE')),
  pumpout_service_name  TEXT,
  location              TEXT,
  amount_in_gallons     NUMERIC(10, 2) NOT NULL,
  log_date              DATE NOT NULL,
  log_time              TEXT NOT NULL,
  created_by_name       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pump_out_logs_vessel_date
  ON public.pump_out_logs(vessel_id, log_date DESC);

ALTER TABLE public.pump_out_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vessel_members_all" ON public.pump_out_logs
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
