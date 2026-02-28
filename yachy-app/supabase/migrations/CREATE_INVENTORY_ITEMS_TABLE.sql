-- Inventory Items (per vessel, per department)
-- Title, Description, Location, items (JSONB array of { amount, item })
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  department TEXT NOT NULL CHECK (department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY')),
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_vessel_id ON public.inventory_items(vessel_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_department ON public.inventory_items(department);

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vessel members can manage inventory items"
  ON public.inventory_items
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.inventory_items IS 'Department inventory: title, description, location, amount/item rows';
