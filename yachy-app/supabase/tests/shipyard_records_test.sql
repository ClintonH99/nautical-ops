\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.current_session_has_device_access()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$ SELECT TRUE; $$;

CREATE OR REPLACE FUNCTION public.vessel_subscription_allows_access(target_vessel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$ SELECT TRUE; $$;

INSERT INTO public.vessels (id, name, invite_code, invite_expiry, is_solo)
VALUES
  (
    '91000000-0000-0000-0000-000000000001',
    'Shipyard Records Test',
    'SHIPRECORD',
    now() + interval '1 year',
    FALSE
  ),
  (
    '91000000-0000-0000-0000-000000000002',
    'Other Vessel Test',
    'OTHERRECORD',
    now() + interval '1 year',
    FALSE
  );

INSERT INTO auth.users (id, email, role, aud, created_at, updated_at)
VALUES
  (
    '92000000-0000-0000-0000-000000000001',
    'captain@shipyard-records.test',
    'authenticated',
    'authenticated',
    now(),
    now()
  ),
  (
    '92000000-0000-0000-0000-000000000002',
    'hod@shipyard-records.test',
    'authenticated',
    'authenticated',
    now(),
    now()
  ),
  (
    '92000000-0000-0000-0000-000000000003',
    'crew@shipyard-records.test',
    'authenticated',
    'authenticated',
    now(),
    now()
  );

INSERT INTO public.users (id, email, name, position, department, vessel_id, role)
VALUES
  (
    '92000000-0000-0000-0000-000000000001',
    'captain@shipyard-records.test',
    'Captain Records',
    'Captain',
    'BRIDGE',
    '91000000-0000-0000-0000-000000000001',
    'CAPTAIN_MOV'
  ),
  (
    '92000000-0000-0000-0000-000000000002',
    'hod@shipyard-records.test',
    'HOD Records',
    'Chief Engineer',
    'ENGINEERING',
    '91000000-0000-0000-0000-000000000001',
    'HOD'
  ),
  (
    '92000000-0000-0000-0000-000000000003',
    'crew@shipyard-records.test',
    'Crew Records',
    'Deckhand',
    'EXTERIOR',
    '91000000-0000-0000-0000-000000000001',
    'CREW'
  );

INSERT INTO public.shipyard_record_folders (id, vessel_id, name)
VALUES (
  '94000000-0000-0000-0000-000000000003',
  '91000000-0000-0000-0000-000000000002',
  'Other Vessel Folder'
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '92000000-0000-0000-0000-000000000003', false);

INSERT INTO public.yard_period_jobs (
  id, vessel_id, job_title, department, priority, status, start_date, end_date
)
VALUES
  (
    '93000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001',
    'Service generator',
    'ENGINEERING',
    'RED',
    'NOT_STARTED',
    '2026-09-12',
    '2026-09-13'
  ),
  (
    '93000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-000000000001',
    'Active hull inspection',
    'EXTERIOR',
    'GREEN',
    'NOT_STARTED',
    '2026-09-14',
    '2026-09-14'
  );

UPDATE public.yard_period_jobs
SET
  status = 'COMPLETED',
  completed_by = '92000000-0000-0000-0000-000000000003',
  completed_by_name = 'Crew Records',
  completed_at = now()
WHERE id = '93000000-0000-0000-0000-000000000001';

INSERT INTO public.shipyard_record_folders (id, vessel_id, name, created_by)
VALUES
  (
    '94000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001',
    'Generators',
    '92000000-0000-0000-0000-000000000003'
  ),
  (
    '94000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-000000000001',
    'Guest Areas',
    '92000000-0000-0000-0000-000000000003'
  );

UPDATE public.shipyard_record_folders
SET name = 'Generator Service'
WHERE id = '94000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF (SELECT count(*) FROM public.shipyard_record_folders) <> 2 THEN
    RAISE EXCEPTION 'Crew could not view all vessel-wide folders';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shipyard_record_folders'
      AND column_name = 'department'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'Deprecated folder department is not nullable for staged compatibility';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.shipyard_record_folders
    WHERE id IN (
      '94000000-0000-0000-0000-000000000001',
      '94000000-0000-0000-0000-000000000002'
    )
      AND department IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'New clients could not create vessel-wide folders without a department';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.shipyard_record_folder_items
    WHERE job_id = '93000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Creating folders assigned a Shipyard Record automatically';
  END IF;

  BEGIN
    INSERT INTO public.shipyard_record_folders (vessel_id, name)
    VALUES (
      '91000000-0000-0000-0000-000000000001',
      '  generator service  '
    );
    RAISE EXCEPTION 'Vessel-wide case-insensitive duplicate folder name was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO public.shipyard_record_folders (vessel_id, department, name)
  VALUES (
    '91000000-0000-0000-0000-000000000001',
    'BRIDGE',
    'Legacy Client Folder'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.shipyard_record_folders
    WHERE vessel_id = '91000000-0000-0000-0000-000000000001'
      AND department = 'BRIDGE'
      AND name = 'Legacy Client Folder'
  ) THEN
    RAISE EXCEPTION 'Older clients can no longer create folders with a department';
  END IF;

  DELETE FROM public.shipyard_record_folders
  WHERE vessel_id = '91000000-0000-0000-0000-000000000001'
    AND name = 'Legacy Client Folder';
END;
$$;

INSERT INTO public.shipyard_record_folder_items (job_id, folder_id)
VALUES (
  '93000000-0000-0000-0000-000000000001',
  '94000000-0000-0000-0000-000000000001'
);

DO $$
BEGIN
  UPDATE public.shipyard_record_folder_items
  SET folder_id = '94000000-0000-0000-0000-000000000002'
  WHERE job_id = '93000000-0000-0000-0000-000000000001';

  IF NOT EXISTS (
    SELECT 1
    FROM public.shipyard_record_folder_items
    WHERE job_id = '93000000-0000-0000-0000-000000000001'
      AND folder_id = '94000000-0000-0000-0000-000000000002'
  ) THEN
    RAISE EXCEPTION 'A record could not move between vessel-wide folders';
  END IF;

  BEGIN
    UPDATE public.shipyard_record_folder_items
    SET folder_id = '94000000-0000-0000-0000-000000000003'
    WHERE job_id = '93000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'A record moved into a folder for another vessel';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.shipyard_record_folder_items
    WHERE job_id = '93000000-0000-0000-0000-000000000001'
      AND folder_id = '94000000-0000-0000-0000-000000000002'
  ) THEN
    RAISE EXCEPTION 'A rejected cross-vessel move changed the folder assignment';
  END IF;

  BEGIN
    INSERT INTO public.shipyard_record_folder_items (job_id, folder_id)
    VALUES (
      '93000000-0000-0000-0000-000000000002',
      '94000000-0000-0000-0000-000000000001'
    );
    RAISE EXCEPTION 'An active Shipyard Job was assigned to a folder';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF EXISTS (
    SELECT 1
    FROM public.shipyard_record_folder_items
    WHERE job_id = '93000000-0000-0000-0000-000000000002'
  ) THEN
    RAISE EXCEPTION 'A rejected active-job placement created an assignment';
  END IF;

  BEGIN
    UPDATE public.yard_period_jobs
    SET job_title = 'Crew changed completed record'
    WHERE id = '93000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Crew edited a completed Shipyard Record';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF EXISTS (
    SELECT * FROM public.unmark_yard_job_complete(
      '93000000-0000-0000-0000-000000000001'
    )
  ) THEN
    RAISE EXCEPTION 'Crew unmarked a completed Shipyard Record';
  END IF;
END;
$$;

DELETE FROM public.yard_period_jobs
WHERE id = '93000000-0000-0000-0000-000000000001';

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.yard_period_jobs
    WHERE id = '93000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Crew deleted a completed Shipyard Record';
  END IF;
END;
$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '92000000-0000-0000-0000-000000000002', false);

DO $$
BEGIN
  BEGIN
    UPDATE public.yard_period_jobs
    SET status = 'NOT_STARTED', job_title = 'HOD altered record while unmarking'
    WHERE id = '93000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'HOD edited a completed Shipyard Record while unmarking it';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

SELECT * FROM public.unmark_yard_job_complete(
  '93000000-0000-0000-0000-000000000001'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.shipyard_record_folder_items
    WHERE job_id = '93000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Unmarking did not return the Shipyard Record to Unfiled';
  END IF;
END;
$$;

UPDATE public.yard_period_jobs
SET
  status = 'COMPLETED',
  completed_by = '92000000-0000-0000-0000-000000000002',
  completed_by_name = 'HOD Records',
  completed_at = now()
WHERE id = '93000000-0000-0000-0000-000000000001';

INSERT INTO public.shipyard_record_folder_items (job_id, folder_id)
VALUES (
  '93000000-0000-0000-0000-000000000001',
  '94000000-0000-0000-0000-000000000002'
);

DO $$
BEGIN
  BEGIN
    UPDATE public.yard_period_jobs
    SET job_title = 'HOD changed completed record'
    WHERE id = '93000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'HOD edited a completed Shipyard Record';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '92000000-0000-0000-0000-000000000001', false);

UPDATE public.yard_period_jobs
SET
  job_title = 'Captain corrected record',
  department = 'INTERIOR'
WHERE id = '93000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.shipyard_record_folder_items
    WHERE job_id = '93000000-0000-0000-0000-000000000001'
      AND folder_id = '94000000-0000-0000-0000-000000000002'
  ) THEN
    RAISE EXCEPTION 'Changing a completed record department removed its folder assignment';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '92000000-0000-0000-0000-000000000002', false);

DELETE FROM public.shipyard_record_folders
WHERE id = '94000000-0000-0000-0000-000000000002';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.yard_period_jobs
    WHERE id = '93000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Deleting a folder deleted its Shipyard Record';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shipyard_record_folder_items
    WHERE job_id = '93000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Deleting a folder did not return its Shipyard Record to Unfiled';
  END IF;
END;
$$;

DELETE FROM public.yard_period_jobs
WHERE id = '93000000-0000-0000-0000-000000000001';

RESET ROLE;

INSERT INTO public.vessel_tasks (
  id, vessel_id, category, department, title, status, created_at, updated_at,
  completed_by, completed_by_name, completed_at
)
VALUES (
  '95000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  'DAILY',
  'INTERIOR',
  'Completed test task',
  'COMPLETED',
  now(),
  now(),
  '92000000-0000-0000-0000-000000000003',
  'Crew Records',
  now()
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '92000000-0000-0000-0000-000000000003', false);

DO $$
BEGIN
  BEGIN
    UPDATE public.vessel_tasks
    SET status = 'NOT_STARTED'
    WHERE id = '95000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Crew unmarked a completed task';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF EXISTS (
    SELECT * FROM public.unmark_vessel_task_complete(
      '95000000-0000-0000-0000-000000000001'
    )
  ) THEN
    RAISE EXCEPTION 'Crew used the task unmark function';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '92000000-0000-0000-0000-000000000002', false);
SELECT * FROM public.unmark_vessel_task_complete(
  '95000000-0000-0000-0000-000000000001'
);

RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.yard_period_jobs
    WHERE id = '93000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'HOD could not delete a completed Shipyard Record';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vessel_tasks
    WHERE id = '95000000-0000-0000-0000-000000000001'
      AND status = 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'HOD could not unmark a completed task';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'shipyard record tests passed' AS result;
