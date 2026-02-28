-- Shopping Lists (per vessel, per department)
-- Run in Supabase SQL Editor
-- Title + bullet-point items (JSONB array of strings)

CREATE TABLE IF NOT EXISTS public.shopping_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  department TEXT NOT NULL CHECK (department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY')),
  title TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_shopping_lists_vessel_id ON public.shopping_lists(vessel_id);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_department ON public.shopping_lists(department);

ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vessel members can manage shopping lists"
  ON public.shopping_lists
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.shopping_lists IS 'Shopping lists with title and bullet items; filterable by department';
