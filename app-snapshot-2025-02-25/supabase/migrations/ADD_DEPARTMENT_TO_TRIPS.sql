-- Add department to trips (mainly for Yard Period trips)
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS department TEXT CHECK (department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'));

CREATE INDEX IF NOT EXISTS idx_trips_department ON public.trips(vessel_id, type, department);

COMMENT ON COLUMN public.trips.department IS 'Department for yard period trips; null for Guest/Boss/Delivery';
