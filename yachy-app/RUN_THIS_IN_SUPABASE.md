# Fix: Missing `department` column in vessel_tasks

**Error:** `Could not find the 'department' column of 'vessel_tasks' in the schema cache`

The app expects a `department` column on `vessel_tasks`, but your Supabase database doesn't have it yet.

## Fix: Run this migration in Supabase SQL Editor

1. Go to your Supabase project: **Dashboard → SQL Editor**
2. Paste and run the SQL below:

```sql
-- Add department to vessel_tasks
ALTER TABLE public.vessel_tasks
  ADD COLUMN IF NOT EXISTS department TEXT;

UPDATE public.vessel_tasks vt
SET department = COALESCE(
  (SELECT u.department FROM public.users u WHERE u.id = vt.created_by),
  'INTERIOR'
)
WHERE vt.department IS NULL;

ALTER TABLE public.vessel_tasks
  ALTER COLUMN department SET NOT NULL,
  ALTER COLUMN department SET DEFAULT 'INTERIOR';

ALTER TABLE public.vessel_tasks
  DROP CONSTRAINT IF EXISTS vessel_tasks_department_check;

ALTER TABLE public.vessel_tasks
  ADD CONSTRAINT vessel_tasks_department_check
  CHECK (department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'));

CREATE INDEX IF NOT EXISTS idx_vessel_tasks_department ON public.vessel_tasks(vessel_id, department);
```

3. Click **Run**
4. Reload the app and try creating a task again
