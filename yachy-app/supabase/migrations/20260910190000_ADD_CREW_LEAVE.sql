-- Crew Leave is a vessel-wide calendar record. Every onboard user may read
-- leave, while only an appointed HOD or Captain/MOV may manage it.

CREATE TABLE IF NOT EXISTS public.crew_leave (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  crew_member_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('ANNUAL', 'SICK', 'ROTATION', 'OTHER')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crew_leave_valid_date_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS crew_leave_vessel_dates_idx
  ON public.crew_leave(vessel_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS crew_leave_member_idx
  ON public.crew_leave(crew_member_id);

DROP TRIGGER IF EXISTS update_crew_leave_updated_at ON public.crew_leave;
CREATE TRIGGER update_crew_leave_updated_at
  BEFORE UPDATE ON public.crew_leave
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.crew_leave ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vessel members read crew leave" ON public.crew_leave;
CREATE POLICY "Vessel members read crew leave"
  ON public.crew_leave FOR SELECT TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id));

DROP POLICY IF EXISTS "HOD and Captain create crew leave" ON public.crew_leave;
CREATE POLICY "HOD and Captain create crew leave"
  ON public.crew_leave FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_can_manage_vessel(vessel_id)
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.users AS selected_crew
      WHERE selected_crew.id = crew_member_id
        AND selected_crew.vessel_id = crew_leave.vessel_id
    )
  );

DROP POLICY IF EXISTS "HOD and Captain update crew leave" ON public.crew_leave;
CREATE POLICY "HOD and Captain update crew leave"
  ON public.crew_leave FOR UPDATE TO authenticated
  USING (public.current_user_can_manage_vessel(vessel_id))
  WITH CHECK (
    public.current_user_can_manage_vessel(vessel_id)
    AND EXISTS (
      SELECT 1 FROM public.users AS selected_crew
      WHERE selected_crew.id = crew_member_id
        AND selected_crew.vessel_id = crew_leave.vessel_id
    )
  );

DROP POLICY IF EXISTS "HOD and Captain delete crew leave" ON public.crew_leave;
CREATE POLICY "HOD and Captain delete crew leave"
  ON public.crew_leave FOR DELETE TO authenticated
  USING (public.current_user_can_manage_vessel(vessel_id));

REVOKE ALL ON TABLE public.crew_leave FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crew_leave TO authenticated;
