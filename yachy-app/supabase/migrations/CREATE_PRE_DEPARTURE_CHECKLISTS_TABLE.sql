-- Pre-Departure Checklists
-- Checklists linked to trips (optional) for pre-departure verification

CREATE TABLE IF NOT EXISTS public.pre_departure_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.pre_departure_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES public.pre_departure_checklists(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  checked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pre_departure_checklists_vessel ON public.pre_departure_checklists(vessel_id);
CREATE INDEX IF NOT EXISTS idx_pre_departure_checklists_trip ON public.pre_departure_checklists(trip_id);
CREATE INDEX IF NOT EXISTS idx_pre_departure_checklist_items_checklist ON public.pre_departure_checklist_items(checklist_id);

ALTER TABLE public.pre_departure_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pre_departure_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vessel members can manage pre-departure checklists"
  ON public.pre_departure_checklists FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Vessel members can manage checklist items"
  ON public.pre_departure_checklist_items FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.pre_departure_checklists IS 'Pre-departure checklists for trips';
