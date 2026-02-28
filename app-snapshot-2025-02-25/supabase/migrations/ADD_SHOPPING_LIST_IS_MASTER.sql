-- Add is_master to shopping_lists for Trip Shopping persistent board
-- Run in Supabase SQL Editor after ADD_SHOPPING_LIST_TYPE.sql

ALTER TABLE public.shopping_lists
  ADD COLUMN IF NOT EXISTS is_master BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shopping_lists_vessel_trip_master
  ON public.shopping_lists(vessel_id)
  WHERE list_type = 'trip' AND is_master = true;

COMMENT ON COLUMN public.shopping_lists.is_master IS 'Master/recurring list for Trip Shopping - one per vessel, always visible';
