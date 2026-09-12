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
VALUES (
  '81000000-0000-0000-0000-000000000001',
  'Sea Mile Folder Test',
  'SEAFOLDER01',
  now() + interval '1 year',
  FALSE
);

INSERT INTO public.users (id, email, name, position, department, vessel_id, role)
VALUES
  (
    '82000000-0000-0000-0000-000000000001',
    'captain@sea-mile-folder.test',
    'Captain Folder',
    'Captain',
    'BRIDGE',
    '81000000-0000-0000-0000-000000000001',
    'CAPTAIN_MOV'
  ),
  (
    '82000000-0000-0000-0000-000000000002',
    'owner@sea-mile-folder.test',
    'Folder Owner',
    'Deckhand',
    'EXTERIOR',
    '81000000-0000-0000-0000-000000000001',
    'CREW'
  ),
  (
    '82000000-0000-0000-0000-000000000003',
    'other@sea-mile-folder.test',
    'Other Crew',
    'Steward',
    'INTERIOR',
    '81000000-0000-0000-0000-000000000001',
    'CREW'
  );

INSERT INTO public.user_signatures (user_id, signature_type, typed_name)
VALUES ('82000000-0000-0000-0000-000000000001', 'typed', 'Captain Folder');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000002', false);

INSERT INTO public.sea_mile_folders (id, user_id, name)
VALUES
  (
    '83000000-0000-0000-0000-000000000001',
    '82000000-0000-0000-0000-000000000002',
    'M/Y Aurora'
  ),
  (
    '83000000-0000-0000-0000-000000000002',
    '82000000-0000-0000-0000-000000000002',
    '2026'
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO public.sea_mile_folders (user_id, name)
    VALUES ('82000000-0000-0000-0000-000000000002', '  m/y aurora  ');
    RAISE EXCEPTION 'Case-insensitive duplicate folder name was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$$;

INSERT INTO public.sea_mile_entries (
  id, user_id, owner_name, voyage_date, vessel_name, vessel_length,
  from_location, to_location, capacity_role, miles_logged, day_hours,
  night_hours, tidal, status
)
VALUES (
  '84000000-0000-0000-0000-000000000001',
  '82000000-0000-0000-0000-000000000002',
  'Ignored client value',
  '2026-09-11',
  'M/Y Aurora',
  '138 ft',
  'Fort Lauderdale',
  'Nassau',
  'Deckhand',
  185,
  8,
  4,
  FALSE,
  'DRAFT'
);

INSERT INTO public.sea_mile_folder_items (entry_id, folder_id)
VALUES (
  '84000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000001'
);

INSERT INTO public.sea_mile_folder_items (entry_id, folder_id)
VALUES (
  '84000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000002'
)
ON CONFLICT (entry_id) DO UPDATE SET folder_id = EXCLUDED.folder_id;

UPDATE public.sea_mile_entries
SET status = 'PENDING'
WHERE id = '84000000-0000-0000-0000-000000000001';

SELECT set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000001', false);

UPDATE public.sea_mile_entries
SET status = 'APPROVED'
WHERE id = '84000000-0000-0000-0000-000000000001';

SELECT set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000002', false);

UPDATE public.sea_mile_folder_items
SET folder_id = '83000000-0000-0000-0000-000000000001'
WHERE entry_id = '84000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.sea_mile_folder_items
    WHERE entry_id = '84000000-0000-0000-0000-000000000001'
      AND folder_id = '83000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Owner could not move an approved entry between folders';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000003', false);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sea_mile_folders) THEN
    RAISE EXCEPTION 'Another crew member could read private folders';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sea_mile_folder_items) THEN
    RAISE EXCEPTION 'Another crew member could read private folder assignments';
  END IF;

  BEGIN
    INSERT INTO public.sea_mile_folder_items (entry_id, folder_id)
    VALUES (
      '84000000-0000-0000-0000-000000000001',
      '83000000-0000-0000-0000-000000000001'
    )
    ON CONFLICT (entry_id) DO UPDATE SET folder_id = EXCLUDED.folder_id;
    RAISE EXCEPTION 'Another crew member changed a private folder assignment';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000002', false);

DELETE FROM public.sea_mile_folders
WHERE id = '83000000-0000-0000-0000-000000000001';

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sea_mile_entries
    WHERE id = '84000000-0000-0000-0000-000000000001'
      AND status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Deleting a folder deleted or changed the approved Sea Miles entry';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sea_mile_folder_items
    WHERE entry_id = '84000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Deleting a folder did not return its entry to Unfiled';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'sea-mile folder tests passed' AS result;
