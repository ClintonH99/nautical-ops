-- Crew may create/edit plans on their current accessible vessel.
-- Existing HOD/MOV policies and all SELECT/DELETE policies remain unchanged.
CREATE POLICY "Crew can create safety_equipment"
  ON public.safety_equipment FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_can_access_vessel(vessel_id)
    AND EXISTS (
      SELECT 1 FROM public.users AS actor
      WHERE actor.id = auth.uid() AND actor.role = 'CREW'
        AND actor.vessel_id = safety_equipment.vessel_id
    )
  );

CREATE POLICY "Crew can update safety_equipment"
  ON public.safety_equipment FOR UPDATE TO authenticated
  USING (
    public.current_user_can_access_vessel(vessel_id)
    AND EXISTS (
      SELECT 1 FROM public.users AS actor
      WHERE actor.id = auth.uid() AND actor.role = 'CREW'
        AND actor.vessel_id = safety_equipment.vessel_id
    )
  )
  WITH CHECK (
    public.current_user_can_access_vessel(vessel_id)
    AND EXISTS (
      SELECT 1 FROM public.users AS actor
      WHERE actor.id = auth.uid() AND actor.role = 'CREW'
        AND actor.vessel_id = safety_equipment.vessel_id
    )
  );
