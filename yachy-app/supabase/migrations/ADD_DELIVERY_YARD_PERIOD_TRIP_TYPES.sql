-- Add Delivery and Yard Period trip types to existing trips table
-- Run this in Supabase SQL Editor (only if trips table already exists)

-- Drop the existing check constraint and add new one including DELIVERY and YARD_PERIOD
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_type_check;

ALTER TABLE public.trips
  ADD CONSTRAINT trips_type_check
  CHECK (type IN ('GUEST', 'BOSS', 'DELIVERY', 'YARD_PERIOD'));

COMMENT ON TABLE public.trips IS 'Guest, Boss, Delivery and Yard Period trips for vessel calendar';
