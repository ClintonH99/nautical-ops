-- Preserve crew-leave history when profiles change or are deleted, and keep
-- the department data needed for reliable historical filtering.

ALTER TABLE public.crew_leave
  ADD COLUMN IF NOT EXISTS crew_member_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS crew_member_position_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS crew_member_departments_snapshot TEXT[];

UPDATE public.crew_leave AS leave
SET
  crew_member_name_snapshot = member.name,
  crew_member_position_snapshot = member.position,
  crew_member_departments_snapshot = CASE
    WHEN member.department_2 IS NOT NULL AND member.department_2 <> member.department
      THEN ARRAY[member.department, member.department_2]
    ELSE ARRAY[member.department]
  END
FROM public.users AS member
WHERE member.id = leave.crew_member_id
  AND (
    leave.crew_member_name_snapshot IS NULL
    OR leave.crew_member_position_snapshot IS NULL
    OR leave.crew_member_departments_snapshot IS NULL
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.crew_leave
    WHERE crew_member_name_snapshot IS NULL
      OR crew_member_position_snapshot IS NULL
      OR crew_member_departments_snapshot IS NULL
  ) THEN
    RAISE EXCEPTION 'Crew leave snapshot backfill failed';
  END IF;
END;
$$;

ALTER TABLE public.crew_leave
  ALTER COLUMN crew_member_name_snapshot SET NOT NULL,
  ALTER COLUMN crew_member_position_snapshot SET NOT NULL,
  ALTER COLUMN crew_member_departments_snapshot SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'crew_leave_departments_snapshot_check'
      AND conrelid = 'public.crew_leave'::regclass
  ) THEN
    ALTER TABLE public.crew_leave
      ADD CONSTRAINT crew_leave_departments_snapshot_check CHECK (
        cardinality(crew_member_departments_snapshot) BETWEEN 1 AND 2
        AND crew_member_departments_snapshot <@ ARRAY[
          'BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'
        ]::TEXT[]
        AND array_position(crew_member_departments_snapshot, NULL) IS NULL
        AND (
          cardinality(crew_member_departments_snapshot) = 1
          OR crew_member_departments_snapshot[1] <> crew_member_departments_snapshot[2]
        )
      );
  END IF;
END;
$$;

-- A leave record is vessel history. Removing either the person whose leave it
-- was or the manager who created it must not erase somebody else's record.
ALTER TABLE public.crew_leave
  DROP CONSTRAINT IF EXISTS crew_leave_crew_member_id_fkey,
  DROP CONSTRAINT IF EXISTS crew_leave_created_by_fkey,
  ALTER COLUMN crew_member_id DROP NOT NULL,
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.crew_leave
  ADD CONSTRAINT crew_leave_crew_member_id_fkey
    FOREIGN KEY (crew_member_id) REFERENCES public.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT crew_leave_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.capture_crew_leave_member_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  selected_member public.users%ROWTYPE;
BEGIN
  IF NEW.crew_member_id IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Crew member is required';
    END IF;

    -- Preserve the immutable snapshot after a referenced account is removed.
    NEW.crew_member_name_snapshot := OLD.crew_member_name_snapshot;
    NEW.crew_member_position_snapshot := OLD.crew_member_position_snapshot;
    NEW.crew_member_departments_snapshot := OLD.crew_member_departments_snapshot;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
    OR NEW.crew_member_id IS DISTINCT FROM OLD.crew_member_id
    OR NEW.vessel_id IS DISTINCT FROM OLD.vessel_id THEN
    SELECT *
    INTO selected_member
    FROM public.users
    WHERE id = NEW.crew_member_id
      AND vessel_id = NEW.vessel_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected crew member must belong to this vessel';
    END IF;

    NEW.crew_member_name_snapshot := selected_member.name;
    NEW.crew_member_position_snapshot := selected_member.position;
    NEW.crew_member_departments_snapshot := CASE
      WHEN selected_member.department_2 IS NOT NULL
        AND selected_member.department_2 <> selected_member.department
        THEN ARRAY[selected_member.department, selected_member.department_2]
      ELSE ARRAY[selected_member.department]
    END;
  ELSE
    -- Snapshot fields are historical evidence and cannot be rewritten through
    -- the API when the referenced crew member has not changed.
    NEW.crew_member_name_snapshot := OLD.crew_member_name_snapshot;
    NEW.crew_member_position_snapshot := OLD.crew_member_position_snapshot;
    NEW.crew_member_departments_snapshot := OLD.crew_member_departments_snapshot;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_crew_leave_member_snapshot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS capture_crew_leave_member_snapshot ON public.crew_leave;
CREATE TRIGGER capture_crew_leave_member_snapshot
  BEFORE INSERT OR UPDATE ON public.crew_leave
  FOR EACH ROW EXECUTE FUNCTION public.capture_crew_leave_member_snapshot();

CREATE INDEX IF NOT EXISTS crew_leave_vessel_list_idx
  ON public.crew_leave(vessel_id, start_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS crew_leave_departments_snapshot_idx
  ON public.crew_leave USING GIN(crew_member_departments_snapshot);

COMMENT ON COLUMN public.crew_leave.crew_member_name_snapshot IS
  'Crew member name captured when this leave record was assigned.';
COMMENT ON COLUMN public.crew_leave.crew_member_position_snapshot IS
  'Crew member position captured when this leave record was assigned.';
COMMENT ON COLUMN public.crew_leave.crew_member_departments_snapshot IS
  'Crew member primary and optional secondary departments captured when assigned.';
