-- Legacy tasks must use the same membership/device/subscription gate as
-- vessel_tasks. Preserve existing SELECT/INSERT/UPDATE capabilities; do not
-- add DELETE access or change billing records, grace periods, or helper logic.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.tasks'::regclass)
    OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.tasks'::regclass) <> 3
    OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.tasks'::regclass
      AND polpermissive AND polroles = ARRAY[0::oid]
      AND ((polname='Users can read vessel tasks' AND polcmd='r')
        OR (polname='Users can create tasks' AND polcmd='a')
        OR (polname='Users can update tasks' AND polcmd='w'))) <> 3
  THEN RAISE EXCEPTION 'Unexpected legacy task policy state; review before applying';
  END IF;
END;
$$;

ALTER POLICY "Users can read vessel tasks" ON public.tasks
  TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id));

ALTER POLICY "Users can create tasks" ON public.tasks
  TO authenticated
  WITH CHECK (public.current_user_can_access_vessel(vessel_id));

ALTER POLICY "Users can update tasks" ON public.tasks
  TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id))
  WITH CHECK (public.current_user_can_access_vessel(vessel_id));
COMMIT;
