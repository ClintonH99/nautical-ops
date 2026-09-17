BEGIN;

CREATE TABLE IF NOT EXISTS public.shipyard_record_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  department TEXT NOT NULL CHECK (
    department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY')
  ),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shipyard_record_folders_unique_name
  ON public.shipyard_record_folders (vessel_id, department, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_shipyard_record_folders_vessel_department
  ON public.shipyard_record_folders (vessel_id, department, name);

CREATE TABLE IF NOT EXISTS public.shipyard_record_folder_items (
  job_id UUID PRIMARY KEY REFERENCES public.yard_period_jobs(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES public.shipyard_record_folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipyard_record_folder_items_folder
  ON public.shipyard_record_folder_items (folder_id);

DROP TRIGGER IF EXISTS update_shipyard_record_folders_updated_at
  ON public.shipyard_record_folders;
CREATE TRIGGER update_shipyard_record_folders_updated_at
  BEFORE UPDATE ON public.shipyard_record_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_shipyard_record_folder_items_updated_at
  ON public.shipyard_record_folder_items;
CREATE TRIGGER update_shipyard_record_folder_items_updated_at
  BEFORE UPDATE ON public.shipyard_record_folder_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.current_user_can_place_shipyard_record(
  target_job_id UUID,
  target_folder_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.yard_period_jobs AS job
    JOIN public.shipyard_record_folders AS folder
      ON folder.id = target_folder_id
     AND folder.vessel_id = job.vessel_id
     AND folder.department = job.department
    WHERE job.id = target_job_id
      AND job.status = 'COMPLETED'
      AND public.current_user_can_access_vessel(job.vessel_id)
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_can_place_shipyard_record(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_can_place_shipyard_record(UUID, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_completed_shipyard_record_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status <> 'COMPLETED' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'COMPLETED' THEN
    IF NEW IS DISTINCT FROM OLD
       AND NOT public.current_user_is_captain_of(OLD.vessel_id) THEN
      RAISE EXCEPTION 'Only the Captain/MOV can edit a completed Shipyard Record.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT public.current_user_can_manage_vessel(OLD.vessel_id) THEN
    RAISE EXCEPTION 'Only the Captain/MOV or an HOD can unmark a completed Shipyard Record.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.current_user_is_captain_of(OLD.vessel_id)
     AND (
       to_jsonb(NEW) - ARRAY[
         'status', 'completed_by', 'completed_at', 'completed_by_name', 'updated_at'
       ]
       IS DISTINCT FROM
       to_jsonb(OLD) - ARRAY[
         'status', 'completed_by', 'completed_at', 'completed_by_name', 'updated_at'
       ]
     ) THEN
    RAISE EXCEPTION 'An HOD can unmark a Shipyard Record but cannot edit its information.'
      USING ERRCODE = '42501';
  END IF;

  NEW.completed_by := NULL;
  NEW.completed_at := NULL;
  NEW.completed_by_name := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_completed_shipyard_record_changes
  ON public.yard_period_jobs;
CREATE TRIGGER enforce_completed_shipyard_record_changes
  BEFORE UPDATE ON public.yard_period_jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_completed_shipyard_record_changes();

CREATE OR REPLACE FUNCTION public.remove_inactive_shipyard_record_folder_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'COMPLETED' OR NEW.department IS DISTINCT FROM OLD.department THEN
    DELETE FROM public.shipyard_record_folder_items WHERE job_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS remove_inactive_shipyard_record_folder_assignment
  ON public.yard_period_jobs;
CREATE TRIGGER remove_inactive_shipyard_record_folder_assignment
  AFTER UPDATE OF status, department ON public.yard_period_jobs
  FOR EACH ROW EXECUTE FUNCTION public.remove_inactive_shipyard_record_folder_assignment();

CREATE OR REPLACE FUNCTION public.enforce_completed_task_unmark_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'COMPLETED'
     AND NEW.status <> 'COMPLETED'
     AND NOT public.current_user_can_manage_vessel(OLD.vessel_id) THEN
    RAISE EXCEPTION 'Only the Captain/MOV or an HOD can unmark a completed task.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_completed_task_unmark_role ON public.vessel_tasks;
CREATE TRIGGER enforce_completed_task_unmark_role
  BEFORE UPDATE OF status ON public.vessel_tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_completed_task_unmark_role();

CREATE OR REPLACE FUNCTION public.unmark_yard_job_complete(target_job_id UUID)
RETURNS TABLE(id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.yard_period_jobs AS job
  SET
    status = 'NOT_STARTED',
    completed_by = NULL,
    completed_at = NULL,
    completed_by_name = NULL,
    updated_at = now()
  WHERE job.id = target_job_id
    AND job.status = 'COMPLETED'
    AND public.current_user_can_manage_vessel(job.vessel_id)
  RETURNING job.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unmark_vessel_task_complete(target_task_id UUID)
RETURNS TABLE(id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.vessel_tasks AS task
  SET
    status = 'NOT_STARTED',
    completed_by = NULL,
    completed_at = NULL,
    completed_by_name = NULL,
    updated_at = now()
  WHERE task.id = target_task_id
    AND task.status = 'COMPLETED'
    AND public.current_user_can_manage_vessel(task.vessel_id)
  RETURNING task.id;
END;
$$;

REVOKE ALL ON FUNCTION public.unmark_yard_job_complete(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unmark_vessel_task_complete(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unmark_yard_job_complete(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unmark_vessel_task_complete(UUID) TO authenticated;

ALTER TABLE public.shipyard_record_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipyard_record_folder_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  old_policy RECORD;
BEGIN
  FOR old_policy IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('shipyard_record_folders', 'shipyard_record_folder_items')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      old_policy.policyname,
      old_policy.tablename
    );
  END LOOP;
END
$$;

CREATE POLICY "Vessel members manage Shipyard Record folders"
  ON public.shipyard_record_folders
  FOR ALL TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id))
  WITH CHECK (public.current_user_can_access_vessel(vessel_id));

CREATE POLICY "Vessel members read Shipyard Record folder assignments"
  ON public.shipyard_record_folder_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.yard_period_jobs AS job
      WHERE job.id = job_id
        AND public.current_user_can_access_vessel(job.vessel_id)
    )
  );

CREATE POLICY "Vessel members create Shipyard Record folder assignments"
  ON public.shipyard_record_folder_items
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_place_shipyard_record(job_id, folder_id));

CREATE POLICY "Vessel members move Shipyard Record folder assignments"
  ON public.shipyard_record_folder_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.yard_period_jobs AS job
      WHERE job.id = job_id
        AND public.current_user_can_access_vessel(job.vessel_id)
    )
  )
  WITH CHECK (public.current_user_can_place_shipyard_record(job_id, folder_id));

CREATE POLICY "Vessel members remove Shipyard Record folder assignments"
  ON public.shipyard_record_folder_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.yard_period_jobs AS job
      WHERE job.id = job_id
        AND public.current_user_can_access_vessel(job.vessel_id)
    )
  );

DROP POLICY IF EXISTS "Active vessel members can manage yard_period_jobs"
  ON public.yard_period_jobs;

CREATE POLICY "Vessel members read Shipyard Jobs"
  ON public.yard_period_jobs
  FOR SELECT TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id));

CREATE POLICY "Vessel members create Shipyard Jobs"
  ON public.yard_period_jobs
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_access_vessel(vessel_id));

CREATE POLICY "Vessel members update Shipyard Jobs"
  ON public.yard_period_jobs
  FOR UPDATE TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id))
  WITH CHECK (public.current_user_can_access_vessel(vessel_id));

CREATE POLICY "Members delete active jobs; HOD and Captain delete records"
  ON public.yard_period_jobs
  FOR DELETE TO authenticated
  USING (
    public.current_user_can_access_vessel(vessel_id)
    AND (
      status <> 'COMPLETED'
      OR public.current_user_can_manage_vessel(vessel_id)
    )
  );

REVOKE ALL ON TABLE public.shipyard_record_folders FROM anon;
REVOKE ALL ON TABLE public.shipyard_record_folder_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shipyard_record_folders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shipyard_record_folder_items TO authenticated;

COMMENT ON TABLE public.shipyard_record_folders IS
  'Vessel-wide, department-specific folders used to organise completed Shipyard Records.';
COMMENT ON TABLE public.shipyard_record_folder_items IS
  'Optional one-folder assignment for a completed Shipyard Record; deleting a folder leaves the job intact.';

COMMIT;
