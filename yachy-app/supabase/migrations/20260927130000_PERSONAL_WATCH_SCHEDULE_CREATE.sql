-- Shared vessels remain HOD/Captain-only. Allow creation in the user's own
-- private Crew Account workspace; no UPDATE/DELETE or rules permissions change.
CREATE POLICY "Personal Crew accounts can create watch schedules"
  ON public.watch_keeping_timetables FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_can_access_vessel(vessel_id)
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.users AS actor
      JOIN public.vessels AS workspace ON workspace.id = actor.vessel_id
      WHERE actor.id = auth.uid() AND actor.role = 'CREW'
        AND workspace.id = watch_keeping_timetables.vessel_id
        AND workspace.is_solo = TRUE
    )
  );
