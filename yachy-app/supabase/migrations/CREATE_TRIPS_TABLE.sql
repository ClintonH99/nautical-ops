-- Trips table for Upcoming Trips (Guest Trips & Boss Trips)
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('GUEST', 'BOSS', 'DELIVERY', 'YARD_PERIOD')),
  title TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for listing trips by vessel and type
CREATE INDEX IF NOT EXISTS idx_trips_vessel_id ON public.trips(vessel_id);
CREATE INDEX IF NOT EXISTS idx_trips_vessel_type ON public.trips(vessel_id, type);
CREATE INDEX IF NOT EXISTS idx_trips_dates ON public.trips(start_date, end_date);

-- RLS: disabled for now (same as users). App filters by vessel_id.
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

-- Allow all for vessel members (simplified; tighten later with proper RLS)
CREATE POLICY "Vessel members can manage trips"
  ON public.trips
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.trips IS 'Guest, Boss, Delivery and Yard Period trips for vessel calendar';
