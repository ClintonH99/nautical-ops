BEGIN;

-- Convert active tasks to the approved category-specific recurrence model.
-- Existing deadlines are preserved. Missing recurring deadlines are calculated
-- from the task's original creation date.
UPDATE public.vessel_tasks
SET
  recurring = CASE
    WHEN category = 'DAILY' THEN NULL
    WHEN category = 'WEEKLY' AND recurring IN ('7_DAYS', '14_DAYS') THEN recurring
    WHEN category = 'WEEKLY' THEN '7_DAYS'
    WHEN category = 'MONTHLY' AND recurring IN ('14_DAYS', '30_DAYS') THEN recurring
    WHEN category = 'MONTHLY' THEN '30_DAYS'
    ELSE recurring
  END,
  done_by_date = CASE
    WHEN done_by_date IS NOT NULL THEN done_by_date
    WHEN category = 'WEEKLY' THEN
      (created_at AT TIME ZONE 'UTC')::date
      + CASE WHEN recurring = '14_DAYS' THEN 14 ELSE 7 END
    WHEN category = 'MONTHLY' THEN
      (created_at AT TIME ZONE 'UTC')::date
      + CASE WHEN recurring = '14_DAYS' THEN 14 ELSE 30 END
    ELSE done_by_date
  END,
  updated_at = now()
WHERE status <> 'COMPLETED';

ALTER TABLE public.vessel_tasks
  DROP CONSTRAINT IF EXISTS vessel_tasks_recurring_check;

ALTER TABLE public.vessel_tasks
  ADD CONSTRAINT vessel_tasks_category_recurring_check CHECK (
    status = 'COMPLETED'
    OR (category = 'DAILY' AND recurring IS NULL)
    OR (category = 'WEEKLY' AND recurring IN ('7_DAYS', '14_DAYS'))
    OR (category = 'MONTHLY' AND recurring IN ('14_DAYS', '30_DAYS'))
  ),
  ADD CONSTRAINT vessel_tasks_recurring_deadline_check CHECK (
    status = 'COMPLETED'
    OR category = 'DAILY'
    OR done_by_date IS NOT NULL
  );

COMMIT;
