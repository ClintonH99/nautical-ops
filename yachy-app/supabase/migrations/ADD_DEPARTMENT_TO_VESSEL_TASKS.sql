-- Add department to vessel_tasks so HODs can create tasks for their department
-- Each department HOD creates tasks for their crew; users filter by department to see only their tasks.

ALTER TABLE public.vessel_tasks
  ADD COLUMN IF NOT EXISTS department TEXT;

-- Backfill existing tasks: use creator's department if available, else INTERIOR
UPDATE public.vessel_tasks vt
SET department = COALESCE(
  (SELECT u.department FROM public.users u WHERE u.id = vt.created_by),
  'INTERIOR'
)
WHERE vt.department IS NULL;

-- Now enforce NOT NULL and valid values
ALTER TABLE public.vessel_tasks
  ALTER COLUMN department SET NOT NULL,
  ALTER COLUMN department SET DEFAULT 'INTERIOR';

ALTER TABLE public.vessel_tasks
  DROP CONSTRAINT IF EXISTS vessel_tasks_department_check;

ALTER TABLE public.vessel_tasks
  ADD CONSTRAINT vessel_tasks_department_check
  CHECK (department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'));

CREATE INDEX IF NOT EXISTS idx_vessel_tasks_department ON public.vessel_tasks(vessel_id, department);

COMMENT ON COLUMN public.vessel_tasks.department IS 'Department this task belongs to; HODs filter by department to see only their crew tasks';
