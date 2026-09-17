BEGIN;

LOCK TABLE public.shipyard_record_folders IN ACCESS EXCLUSIVE MODE;

-- The original folder model allowed the same name once per department. Preserve
-- every folder and assignment while making those names unique vessel-wide.
-- The oldest folder keeps the original name; later collisions receive a stable,
-- human-readable department suffix. A numeric suffix resolves names that already
-- use that wording.
DROP INDEX IF EXISTS public.shipyard_record_folders_unique_name;

DO $$
DECLARE
  duplicate_folder RECORD;
  candidate_name TEXT;
  name_suffix TEXT;
  collision_number INTEGER;
BEGIN
  FOR duplicate_folder IN
    SELECT ranked.id, ranked.vessel_id, ranked.name, ranked.department
    FROM (
      SELECT
        folder.id,
        folder.vessel_id,
        folder.name,
        folder.department,
        row_number() OVER (
          PARTITION BY folder.vessel_id, lower(btrim(folder.name))
          ORDER BY folder.created_at, folder.id
        ) AS duplicate_rank
      FROM public.shipyard_record_folders AS folder
    ) AS ranked
    WHERE ranked.duplicate_rank > 1
    ORDER BY ranked.vessel_id, lower(btrim(ranked.name)), ranked.duplicate_rank
  LOOP
    collision_number := 1;

    LOOP
      name_suffix := CASE
        WHEN collision_number = 1
          THEN format(' (%s)', initcap(lower(duplicate_folder.department)))
        ELSE format(
          ' (%s %s)',
          initcap(lower(duplicate_folder.department)),
          collision_number
        )
      END;
      candidate_name :=
        left(btrim(duplicate_folder.name), 80 - char_length(name_suffix)) || name_suffix;

      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.shipyard_record_folders AS existing
        WHERE existing.vessel_id = duplicate_folder.vessel_id
          AND existing.id <> duplicate_folder.id
          AND lower(btrim(existing.name)) = lower(btrim(candidate_name))
      );

      collision_number := collision_number + 1;
    END LOOP;

    UPDATE public.shipyard_record_folders
    SET name = candidate_name
    WHERE id = duplicate_folder.id;
  END LOOP;
END
$$;

-- Folder placement remains explicit, but the folder no longer needs to match the
-- record's department. Vessel membership and completed status are still enforced.
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
    WHERE job.id = target_job_id
      AND job.status = 'COMPLETED'
      AND public.current_user_can_access_vessel(job.vessel_id)
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_can_place_shipyard_record(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_can_place_shipyard_record(UUID, UUID)
  TO authenticated;

-- Department edits no longer invalidate a vessel-wide folder assignment. Keep
-- the cleanup only for records that leave the completed state, and recreate the
-- trigger before relaxing the column referenced by the deployed trigger.
CREATE OR REPLACE FUNCTION public.remove_inactive_shipyard_record_folder_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'COMPLETED' THEN
    DELETE FROM public.shipyard_record_folder_items WHERE job_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS remove_inactive_shipyard_record_folder_assignment
  ON public.yard_period_jobs;
CREATE TRIGGER remove_inactive_shipyard_record_folder_assignment
  AFTER UPDATE OF status ON public.yard_period_jobs
  FOR EACH ROW EXECUTE FUNCTION public.remove_inactive_shipyard_record_folder_assignment();

DROP INDEX IF EXISTS public.idx_shipyard_record_folders_vessel_department;

-- Keep the old column temporarily so already-released clients that still send a
-- department can create folders during the staged rollout. New clients omit it.
-- A later migration can remove it after old binaries are outside support.
ALTER TABLE public.shipyard_record_folders
  ALTER COLUMN department DROP NOT NULL;

CREATE UNIQUE INDEX shipyard_record_folders_unique_name
  ON public.shipyard_record_folders (vessel_id, lower(btrim(name)));

CREATE INDEX idx_shipyard_record_folders_vessel_name
  ON public.shipyard_record_folders (vessel_id, name);

COMMENT ON TABLE public.shipyard_record_folders IS
  'Vessel-wide folders used to organise completed Shipyard Records.';
COMMENT ON COLUMN public.shipyard_record_folders.department IS
  'Deprecated compatibility field for older app versions; ignored by vessel-wide folder behaviour and nullable for new clients.';
COMMENT ON TABLE public.shipyard_record_folder_items IS
  'Optional one-folder assignment for a completed Shipyard Record; assignments are explicit and folders are vessel-wide.';
COMMENT ON FUNCTION public.current_user_can_place_shipyard_record(UUID, UUID) IS
  'Allows an accessible completed Shipyard Record to be placed only in a folder owned by the same vessel.';
COMMENT ON FUNCTION public.remove_inactive_shipyard_record_folder_assignment() IS
  'Removes a Shipyard Record folder assignment only when the job leaves the completed state.';

COMMIT;
