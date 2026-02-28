-- Add Port / Starboard or NA to existing maintenance_logs table
-- Run in Supabase SQL Editor if the table already exists

ALTER TABLE public.maintenance_logs
  ADD COLUMN IF NOT EXISTS port_starboard_na TEXT;

COMMENT ON COLUMN public.maintenance_logs.port_starboard_na IS 'Port, Starboard or NA';
