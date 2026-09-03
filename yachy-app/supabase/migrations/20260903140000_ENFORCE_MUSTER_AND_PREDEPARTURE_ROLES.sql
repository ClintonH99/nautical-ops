-- Enforce the role permissions used by the app for Muster Stations and
-- Pre-Departure Checklists. UI guards are not a security boundary; these
-- policies prevent direct client calls from bypassing the screens.

CREATE OR REPLACE FUNCTION public.is_vessel_hod_or_captain(target_vessel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS current_user_row
    WHERE current_user_row.id = auth.uid()
      AND current_user_row.vessel_id = target_vessel_id
      AND current_user_row.role IN ('HOD', 'CAPTAIN_MOV')
  );
$$;

REVOKE ALL ON FUNCTION public.is_vessel_hod_or_captain(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_vessel_hod_or_captain(UUID) TO authenticated;

-- The repository previously had no creation migration for this client-used table.
CREATE TABLE IF NOT EXISTS public.muster_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_muster_stations_vessel_id
  ON public.muster_stations(vessel_id);

ALTER TABLE public.muster_stations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  existing_policy RECORD;
BEGIN
  FOR existing_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'muster_stations'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.muster_stations',
      existing_policy.policyname
    );
  END LOOP;
END
$$;

CREATE POLICY "Vessel members can read muster stations"
  ON public.muster_stations
  FOR SELECT
  TO authenticated
  USING (
    vessel_id IN (
      SELECT vessel_id FROM public.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "HOD and Captain can create muster stations"
  ON public.muster_stations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_vessel_hod_or_captain(vessel_id));

CREATE POLICY "HOD and Captain can update muster stations"
  ON public.muster_stations
  FOR UPDATE
  TO authenticated
  USING (public.is_vessel_hod_or_captain(vessel_id))
  WITH CHECK (public.is_vessel_hod_or_captain(vessel_id));

CREATE POLICY "HOD and Captain can delete muster stations"
  ON public.muster_stations
  FOR DELETE
  TO authenticated
  USING (public.is_vessel_hod_or_captain(vessel_id));

ALTER TABLE public.pre_departure_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pre_departure_checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vessel members can manage pre-departure checklists"
  ON public.pre_departure_checklists;
DROP POLICY IF EXISTS "Vessel members can manage checklist items"
  ON public.pre_departure_checklist_items;

CREATE POLICY "Vessel members can read pre-departure checklists"
  ON public.pre_departure_checklists
  FOR SELECT
  TO authenticated
  USING (
    vessel_id IN (
      SELECT vessel_id FROM public.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "HOD and Captain can create pre-departure checklists"
  ON public.pre_departure_checklists
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_vessel_hod_or_captain(vessel_id));

CREATE POLICY "HOD and Captain can update pre-departure checklists"
  ON public.pre_departure_checklists
  FOR UPDATE
  TO authenticated
  USING (public.is_vessel_hod_or_captain(vessel_id))
  WITH CHECK (public.is_vessel_hod_or_captain(vessel_id));

CREATE POLICY "HOD and Captain can delete pre-departure checklists"
  ON public.pre_departure_checklists
  FOR DELETE
  TO authenticated
  USING (public.is_vessel_hod_or_captain(vessel_id));

CREATE POLICY "Vessel members can read pre-departure checklist items"
  ON public.pre_departure_checklist_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.pre_departure_checklists AS checklist
      JOIN public.users AS current_user_row
        ON current_user_row.vessel_id = checklist.vessel_id
      WHERE checklist.id = checklist_id
        AND current_user_row.id = auth.uid()
    )
  );

CREATE POLICY "HOD and Captain can create pre-departure checklist items"
  ON public.pre_departure_checklist_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.pre_departure_checklists AS checklist
      WHERE checklist.id = checklist_id
        AND public.is_vessel_hod_or_captain(checklist.vessel_id)
    )
  );

CREATE POLICY "HOD and Captain can update pre-departure checklist items"
  ON public.pre_departure_checklist_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.pre_departure_checklists AS checklist
      WHERE checklist.id = checklist_id
        AND public.is_vessel_hod_or_captain(checklist.vessel_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.pre_departure_checklists AS checklist
      WHERE checklist.id = checklist_id
        AND public.is_vessel_hod_or_captain(checklist.vessel_id)
    )
  );

CREATE POLICY "HOD and Captain can delete pre-departure checklist items"
  ON public.pre_departure_checklist_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.pre_departure_checklists AS checklist
      WHERE checklist.id = checklist_id
        AND public.is_vessel_hod_or_captain(checklist.vessel_id)
    )
  );
