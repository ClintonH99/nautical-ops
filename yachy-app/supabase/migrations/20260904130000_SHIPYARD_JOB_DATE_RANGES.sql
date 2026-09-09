BEGIN;

ALTER TABLE public.yard_period_jobs
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE;

-- A linked Yard Period is the most reliable source for an existing job's range.
UPDATE public.yard_period_jobs AS job
SET
  start_date = trip.start_date,
  end_date = trip.end_date,
  updated_at = NOW()
FROM public.trips AS trip
WHERE job.trip_id = trip.id
  AND trip.type = 'YARD_PERIOD';

-- A legacy unlinked deadline becomes a one-day range. Invalid legacy text is
-- preserved in done_by_date but is deliberately not cast.
UPDATE public.yard_period_jobs
SET
  start_date = done_by_date::DATE,
  end_date = done_by_date::DATE,
  updated_at = NOW()
WHERE start_date IS NULL
  AND end_date IS NULL
  AND done_by_date ~ '^\d{4}-\d{2}-\d{2}$';

-- Preserve standalone Yard Period records by representing each one as a
-- Shipyard List job. Existing linked jobs prevent a duplicate placeholder.
INSERT INTO public.yard_period_jobs (
  vessel_id,
  job_title,
  job_description,
  yard_location,
  contractor_company_name,
  contact_details,
  start_date,
  end_date,
  status,
  created_by,
  created_at,
  updated_at,
  department,
  priority,
  trip_id
)
SELECT
  trip.vessel_id,
  trip.title,
  trip.notes,
  trip.yard_location,
  trip.contractor_company_name,
  trip.contact_details,
  trip.start_date,
  trip.end_date,
  'NOT_STARTED',
  trip.created_by,
  trip.created_at,
  trip.updated_at,
  COALESCE(trip.department, 'INTERIOR'),
  'GREEN',
  trip.id
FROM public.trips AS trip
WHERE trip.type = 'YARD_PERIOD'
  AND NOT EXISTS (
    SELECT 1
    FROM public.yard_period_jobs AS existing_job
    WHERE existing_job.trip_id = trip.id
  );

ALTER TABLE public.yard_period_jobs
  DROP CONSTRAINT IF EXISTS yard_period_jobs_date_range_check;

ALTER TABLE public.yard_period_jobs
  ADD CONSTRAINT yard_period_jobs_date_range_check CHECK (
    (start_date IS NULL AND end_date IS NULL)
    OR (start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= start_date)
  );

CREATE INDEX IF NOT EXISTS idx_yard_period_jobs_date_range
  ON public.yard_period_jobs (vessel_id, start_date, end_date)
  WHERE start_date IS NOT NULL AND end_date IS NOT NULL;

COMMENT ON COLUMN public.yard_period_jobs.start_date IS
  'First scheduled day for this individual Shipyard List job.';
COMMENT ON COLUMN public.yard_period_jobs.end_date IS
  'Final scheduled day for this individual Shipyard List job.';
COMMENT ON COLUMN public.yard_period_jobs.done_by_date IS
  'Deprecated legacy deadline retained temporarily for rollback and transfer verification.';

COMMIT;
