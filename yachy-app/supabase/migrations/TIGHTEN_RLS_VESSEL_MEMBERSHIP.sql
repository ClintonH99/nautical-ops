-- Tighten RLS: Replace permissive USING(true)/WITH CHECK(true) with vessel membership
-- Users can only access rows where vessel_id matches their users.vessel_id

-- trips
DROP POLICY IF EXISTS "Vessel members can manage trips" ON public.trips;
CREATE POLICY "Vessel members can manage trips"
  ON public.trips FOR ALL
  USING (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()));

-- vessel_tasks
DROP POLICY IF EXISTS "Vessel members can manage tasks" ON public.vessel_tasks;
CREATE POLICY "Vessel members can manage tasks"
  ON public.vessel_tasks FOR ALL
  USING (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()));

-- yard_period_jobs
DROP POLICY IF EXISTS "Vessel members can manage yard period jobs" ON public.yard_period_jobs;
CREATE POLICY "Vessel members can manage yard period jobs"
  ON public.yard_period_jobs FOR ALL
  USING (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()));

-- contractors
DROP POLICY IF EXISTS "Vessel members can manage contractors" ON public.contractors;
CREATE POLICY "Vessel members can manage contractors"
  ON public.contractors FOR ALL
  USING (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()));

-- inventory_items
DROP POLICY IF EXISTS "Vessel members can manage inventory items" ON public.inventory_items;
CREATE POLICY "Vessel members can manage inventory items"
  ON public.inventory_items FOR ALL
  USING (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()));

-- maintenance_logs
DROP POLICY IF EXISTS "Vessel members can manage maintenance logs" ON public.maintenance_logs;
CREATE POLICY "Vessel members can manage maintenance logs"
  ON public.maintenance_logs FOR ALL
  USING (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()));

-- watch_keeping_timetables
DROP POLICY IF EXISTS "Vessel members can manage watch timetables" ON public.watch_keeping_timetables;
CREATE POLICY "Vessel members can manage watch timetables"
  ON public.watch_keeping_timetables FOR ALL
  USING (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()));

-- watch_keeping_rules (vessel_id is UNIQUE)
DROP POLICY IF EXISTS "Vessel members can read and manage watch rules" ON public.watch_keeping_rules;
CREATE POLICY "Vessel members can read and manage watch rules"
  ON public.watch_keeping_rules FOR ALL
  USING (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()));

-- shopping_lists
DROP POLICY IF EXISTS "Vessel members can manage shopping lists" ON public.shopping_lists;
CREATE POLICY "Vessel members can manage shopping lists"
  ON public.shopping_lists FOR ALL
  USING (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()));

-- vessel_trip_colors (vessel_id is PRIMARY KEY)
DROP POLICY IF EXISTS "Vessel members can manage trip colors" ON public.vessel_trip_colors;
CREATE POLICY "Vessel members can manage trip colors"
  ON public.vessel_trip_colors FOR ALL
  USING (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()));

-- pre_departure_checklists
DROP POLICY IF EXISTS "Vessel members can manage pre-departure checklists" ON public.pre_departure_checklists;
CREATE POLICY "Vessel members can manage pre-departure checklists"
  ON public.pre_departure_checklists FOR ALL
  USING (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()));

-- pre_departure_checklist_items (no vessel_id; join via checklist)
DROP POLICY IF EXISTS "Vessel members can manage checklist items" ON public.pre_departure_checklist_items;
CREATE POLICY "Vessel members can manage checklist items"
  ON public.pre_departure_checklist_items FOR ALL
  USING (
    checklist_id IN (
      SELECT id FROM public.pre_departure_checklists
      WHERE vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    checklist_id IN (
      SELECT id FROM public.pre_departure_checklists
      WHERE vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid())
    )
  );
