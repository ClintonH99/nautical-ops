-- Fuel Logs Table
-- Stores vessel fuel refueling log entries

CREATE TABLE IF NOT EXISTS public.fuel_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id             UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  location_of_refueling TEXT,
  log_date              DATE NOT NULL,
  log_time              TEXT NOT NULL,
  amount_of_fuel        NUMERIC(10, 2) NOT NULL,
  price_per_gallon      NUMERIC(10, 4) NOT NULL,
  total_price           NUMERIC(12, 2) NOT NULL,
  created_by_name       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_logs_vessel_date
  ON public.fuel_logs(vessel_id, log_date DESC);

ALTER TABLE public.fuel_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vessel_members_all" ON public.fuel_logs
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
