-- Add description column to pump_out_logs (optional field for notes like "Tipped the dockhand $20")

ALTER TABLE public.pump_out_logs
  ADD COLUMN IF NOT EXISTS description TEXT;
