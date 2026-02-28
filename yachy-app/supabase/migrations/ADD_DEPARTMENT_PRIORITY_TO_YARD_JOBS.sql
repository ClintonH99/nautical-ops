-- Add department and priority to yard_period_jobs

ALTER TABLE public.yard_period_jobs
  ADD COLUMN IF NOT EXISTS department TEXT DEFAULT 'INTERIOR',
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'GREEN';

UPDATE public.yard_period_jobs
SET department = COALESCE(department, 'INTERIOR'),
    priority = COALESCE(priority, 'GREEN')
WHERE department IS NULL OR priority IS NULL;

ALTER TABLE public.yard_period_jobs
  ALTER COLUMN department SET NOT NULL,
  ALTER COLUMN department SET DEFAULT 'INTERIOR',
  ALTER COLUMN priority SET NOT NULL,
  ALTER COLUMN priority SET DEFAULT 'GREEN';

ALTER TABLE public.yard_period_jobs
  DROP CONSTRAINT IF EXISTS yard_period_jobs_department_check;

ALTER TABLE public.yard_period_jobs
  ADD CONSTRAINT yard_period_jobs_department_check
  CHECK (department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'));

ALTER TABLE public.yard_period_jobs
  DROP CONSTRAINT IF EXISTS yard_period_jobs_priority_check;

ALTER TABLE public.yard_period_jobs
  ADD CONSTRAINT yard_period_jobs_priority_check
  CHECK (priority IN ('GREEN', 'YELLOW', 'RED'));
