\set ON_ERROR_STOP on

BEGIN;

-- The isolated schema-replay container has no device request header or billing
-- provider. Keep those two unrelated gates open for this focused RLS test.
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
  '71000000-0000-0000-0000-000000000001',
  'Sea Mile Contact Test',
  'SEAMILE00001',
  now() + interval '1 year',
  FALSE
);

INSERT INTO public.users (id, email, name, position, department, vessel_id, role)
VALUES
  (
    '72000000-0000-0000-0000-000000000001',
    'captain@sea-mile-contact.test',
    'John Carter',
    'Captain',
    'BRIDGE',
    '71000000-0000-0000-0000-000000000001',
    'CAPTAIN_MOV'
  ),
  (
    '72000000-0000-0000-0000-000000000002',
    'crew@sea-mile-contact.test',
    'Rachel Evans',
    'Deckhand',
    'EXTERIOR',
    '71000000-0000-0000-0000-000000000001',
    'CREW'
  );

INSERT INTO public.user_signatures (
  user_id, signature_type, signature_image, typed_name
)
VALUES (
  '72000000-0000-0000-0000-000000000001',
  'typed',
  NULL,
  'John Carter'
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000001', false);

INSERT INTO public.captain_sea_mile_contacts (
  user_id, first_name, last_name, cell_number, email_address
)
VALUES (
  '72000000-0000-0000-0000-000000000001',
  'John',
  'Carter',
  '+1 954 555 0148',
  'john.carter@example.com'
);

SELECT set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000002', false);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.captain_sea_mile_contacts) THEN
    RAISE EXCEPTION 'Crew could read the Captain/MOV private contact setup';
  END IF;

  BEGIN
    INSERT INTO public.captain_sea_mile_contacts (
      user_id, first_name, last_name, email_address
    ) VALUES (
      '72000000-0000-0000-0000-000000000002',
      'Rachel',
      'Evans',
      'rachel@example.com'
    );
    RAISE EXCEPTION 'Crew created a Captain/MOV contact setup';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

INSERT INTO public.sea_mile_entries (
  id,
  user_id,
  owner_name,
  voyage_date,
  vessel_name,
  vessel_length,
  from_location,
  to_location,
  capacity_role,
  miles_logged,
  day_hours,
  night_hours,
  tidal,
  status,
  reviewer_contact_first_name,
  reviewer_contact_last_name,
  reviewer_contact_email_address
)
VALUES (
  '73000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000002',
  'Ignored client value',
  '2026-09-11',
  'M/Y Aurora',
  '138 ft',
  'Miami',
  'Nassau',
  'Deckhand',
  184,
  8,
  6,
  FALSE,
  'DRAFT',
  'Forged',
  'Captain',
  'forged@example.com'
);

UPDATE public.sea_mile_entries
SET status = 'PENDING'
WHERE id = '73000000-0000-0000-0000-000000000001';

SELECT set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000001', false);

UPDATE public.sea_mile_entries
SET status = 'APPROVED'
WHERE id = '73000000-0000-0000-0000-000000000001';

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.sea_mile_entries
    WHERE id = '73000000-0000-0000-0000-000000000001'
      AND status = 'APPROVED'
      AND owner_name = 'Rachel Evans'
      AND reviewer_name = 'John Carter'
      AND reviewer_contact_first_name = 'John'
      AND reviewer_contact_last_name = 'Carter'
      AND reviewer_contact_cell_number = '+1 954 555 0148'
      AND reviewer_contact_email_address = 'john.carter@example.com'
  ) THEN
    RAISE EXCEPTION 'Approval did not capture the verified Captain/MOV contact details';
  END IF;
END;
$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000001', false);

UPDATE public.captain_sea_mile_contacts
SET cell_number = '+1 305 555 0199'
WHERE user_id = '72000000-0000-0000-0000-000000000001';

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.sea_mile_entries
    WHERE id = '73000000-0000-0000-0000-000000000001'
      AND reviewer_contact_cell_number = '+1 954 555 0148'
  ) THEN
    RAISE EXCEPTION 'Editing the saved contact changed an approved historical snapshot';
  END IF;
END;
$$;

-- An older installed app has no contact setup screen. Its approval must remain
-- valid during the Expo Go testing period instead of breaking TestFlight users.
DELETE FROM public.captain_sea_mile_contacts
WHERE user_id = '72000000-0000-0000-0000-000000000001';

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000002', false);

INSERT INTO public.sea_mile_entries (
  id,
  user_id,
  owner_name,
  voyage_date,
  vessel_name,
  vessel_length,
  from_location,
  to_location,
  capacity_role,
  miles_logged,
  day_hours,
  night_hours,
  tidal,
  status
)
VALUES (
  '73000000-0000-0000-0000-000000000002',
  '72000000-0000-0000-0000-000000000002',
  'Ignored client value',
  '2026-09-12',
  'M/Y Aurora',
  '138 ft',
  'Nassau',
  'Miami',
  'Deckhand',
  184,
  8,
  6,
  FALSE,
  'DRAFT'
);

UPDATE public.sea_mile_entries
SET status = 'PENDING'
WHERE id = '73000000-0000-0000-0000-000000000002';

SELECT set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000001', false);

UPDATE public.sea_mile_entries
SET status = 'APPROVED'
WHERE id = '73000000-0000-0000-0000-000000000002';

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.sea_mile_entries
    WHERE id = '73000000-0000-0000-0000-000000000002'
      AND status = 'APPROVED'
      AND reviewer_contact_first_name IS NULL
      AND reviewer_contact_last_name IS NULL
      AND reviewer_contact_cell_number IS NULL
      AND reviewer_contact_email_address IS NULL
  ) THEN
    RAISE EXCEPTION 'Backward-compatible approval without contact setup failed';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'sea-mile Captain contact tests passed' AS result;
