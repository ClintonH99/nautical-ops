-- Captain/MOV verification details are saved once, remain editable for future
-- approvals, and are snapshotted onto each approved sea-mile entry so a crew
-- member's historical record remains complete after either person changes vessel.

CREATE TABLE IF NOT EXISTS public.captain_sea_mile_contacts (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL CHECK (char_length(trim(first_name)) BETWEEN 1 AND 80),
  last_name TEXT NOT NULL CHECK (char_length(trim(last_name)) BETWEEN 1 AND 80),
  cell_number TEXT CHECK (
    cell_number IS NULL OR char_length(trim(cell_number)) BETWEEN 5 AND 40
  ),
  email_address TEXT CHECK (
    email_address IS NULL OR char_length(trim(email_address)) BETWEEN 3 AND 254
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT captain_sea_mile_contact_method_required CHECK (
    nullif(trim(cell_number), '') IS NOT NULL
    OR nullif(trim(email_address), '') IS NOT NULL
  )
);

ALTER TABLE public.captain_sea_mile_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Captains read own sea-mile contact" ON public.captain_sea_mile_contacts;
CREATE POLICY "Captains read own sea-mile contact"
  ON public.captain_sea_mile_contacts FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Captains create own sea-mile contact" ON public.captain_sea_mile_contacts;
CREATE POLICY "Captains create own sea-mile contact"
  ON public.captain_sea_mile_contacts FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'CAPTAIN_MOV'
    )
  );

DROP POLICY IF EXISTS "Captains update own sea-mile contact" ON public.captain_sea_mile_contacts;
CREATE POLICY "Captains update own sea-mile contact"
  ON public.captain_sea_mile_contacts FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'CAPTAIN_MOV'
    )
  );

DROP TRIGGER IF EXISTS update_captain_sea_mile_contacts_updated_at
  ON public.captain_sea_mile_contacts;
CREATE TRIGGER update_captain_sea_mile_contacts_updated_at
  BEFORE UPDATE ON public.captain_sea_mile_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON TABLE public.captain_sea_mile_contacts FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.captain_sea_mile_contacts TO authenticated;

ALTER TABLE public.sea_mile_entries
  ADD COLUMN IF NOT EXISTS reviewer_contact_first_name TEXT,
  ADD COLUMN IF NOT EXISTS reviewer_contact_last_name TEXT,
  ADD COLUMN IF NOT EXISTS reviewer_contact_cell_number TEXT,
  ADD COLUMN IF NOT EXISTS reviewer_contact_email_address TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sea_mile_reviewer_contact_snapshot_complete'
      AND conrelid = 'public.sea_mile_entries'::regclass
  ) THEN
    ALTER TABLE public.sea_mile_entries
      ADD CONSTRAINT sea_mile_reviewer_contact_snapshot_complete CHECK (
        (
          reviewer_contact_first_name IS NULL
          AND reviewer_contact_last_name IS NULL
          AND reviewer_contact_cell_number IS NULL
          AND reviewer_contact_email_address IS NULL
        )
        OR (
          nullif(trim(reviewer_contact_first_name), '') IS NOT NULL
          AND nullif(trim(reviewer_contact_last_name), '') IS NOT NULL
          AND (
            nullif(trim(reviewer_contact_cell_number), '') IS NOT NULL
            OR nullif(trim(reviewer_contact_email_address), '') IS NOT NULL
          )
        )
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_sea_mile_reviewer_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  contact_row public.captain_sea_mile_contacts%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.reviewer_contact_first_name := NULL;
    NEW.reviewer_contact_last_name := NULL;
    NEW.reviewer_contact_cell_number := NULL;
    NEW.reviewer_contact_email_address := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status = 'PENDING' AND NEW.status = 'APPROVED' THEN
    IF OLD.review_vessel_id IS NULL
      OR NOT public.current_user_is_captain_of(OLD.review_vessel_id) THEN
      RAISE EXCEPTION 'Only the vessel Captain/MOV can approve sea miles';
    END IF;

    SELECT * INTO contact_row
    FROM public.captain_sea_mile_contacts
    WHERE user_id = auth.uid();

    IF FOUND THEN
      NEW.reviewer_contact_first_name := contact_row.first_name;
      NEW.reviewer_contact_last_name := contact_row.last_name;
      NEW.reviewer_contact_cell_number := contact_row.cell_number;
      NEW.reviewer_contact_email_address := contact_row.email_address;
    ELSE
      -- Keep older installed app versions working while this additive feature
      -- is tested in Expo Go. The new client requires contact setup before it
      -- sends an approval; old clients may approve without the new snapshot.
      NEW.reviewer_contact_first_name := NULL;
      NEW.reviewer_contact_last_name := NULL;
      NEW.reviewer_contact_cell_number := NULL;
      NEW.reviewer_contact_email_address := NULL;
    END IF;
  ELSE
    -- Clients cannot write or alter verification snapshots directly.
    NEW.reviewer_contact_first_name := NULL;
    NEW.reviewer_contact_last_name := NULL;
    NEW.reviewer_contact_cell_number := NULL;
    NEW.reviewer_contact_email_address := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_sea_mile_reviewer_contact() FROM PUBLIC;

DROP TRIGGER IF EXISTS capture_sea_mile_reviewer_contact_trigger
  ON public.sea_mile_entries;
CREATE TRIGGER capture_sea_mile_reviewer_contact_trigger
  BEFORE INSERT OR UPDATE ON public.sea_mile_entries
  FOR EACH ROW EXECUTE FUNCTION public.capture_sea_mile_reviewer_contact();
