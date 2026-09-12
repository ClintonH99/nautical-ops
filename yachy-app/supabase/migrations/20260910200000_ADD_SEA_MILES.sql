-- Personal sea-service records belong permanently to the crew member rather
-- than to a vessel. A vessel is attached only while an entry is awaiting
-- Captain/MOV review. Approval snapshots the Captain's name and signature so
-- historical records do not change if either person later changes vessel.

CREATE TABLE IF NOT EXISTS public.sea_mile_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  owner_name TEXT NOT NULL,
  review_vessel_id UUID REFERENCES public.vessels(id) ON DELETE SET NULL,
  voyage_date DATE NOT NULL,
  vessel_name TEXT NOT NULL CHECK (char_length(trim(vessel_name)) BETWEEN 1 AND 160),
  vessel_length TEXT NOT NULL CHECK (char_length(trim(vessel_length)) BETWEEN 1 AND 80),
  from_location TEXT NOT NULL CHECK (char_length(trim(from_location)) BETWEEN 1 AND 160),
  to_location TEXT NOT NULL CHECK (char_length(trim(to_location)) BETWEEN 1 AND 160),
  capacity_role TEXT NOT NULL CHECK (char_length(trim(capacity_role)) BETWEEN 1 AND 120),
  miles_logged NUMERIC(12, 2) NOT NULL CHECK (miles_logged >= 0),
  day_hours NUMERIC(12, 2) NOT NULL CHECK (day_hours >= 0),
  night_hours NUMERIC(12, 2) NOT NULL CHECK (night_hours >= 0),
  tidal BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED', 'DECLINED')),
  decline_comment TEXT CHECK (decline_comment IS NULL OR char_length(decline_comment) <= 1000),
  submitted_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewer_name TEXT,
  reviewer_signature_type TEXT
    CHECK (reviewer_signature_type IS NULL OR reviewer_signature_type IN ('drawn', 'typed')),
  reviewer_signature_image TEXT,
  reviewer_typed_name TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sea_mile_entry_approval_snapshot_complete CHECK (
    status <> 'APPROVED'
    OR (
      reviewed_by IS NOT NULL
      AND reviewer_name IS NOT NULL
      AND reviewer_signature_type IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND (
        (reviewer_signature_type = 'drawn' AND reviewer_signature_image IS NOT NULL)
        OR (reviewer_signature_type = 'typed' AND reviewer_typed_name IS NOT NULL)
      )
    )
  ),
  CONSTRAINT sea_mile_entry_decline_has_reason CHECK (
    status <> 'DECLINED' OR nullif(trim(decline_comment), '') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS sea_mile_entries_owner_date_idx
  ON public.sea_mile_entries(user_id, voyage_date DESC);
CREATE INDEX IF NOT EXISTS sea_mile_entries_review_queue_idx
  ON public.sea_mile_entries(review_vessel_id, status, submitted_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_sea_mile_entry_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_role TEXT;
  actor_name TEXT;
  actor_vessel_id UUID;
  signature_row public.user_signatures%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required';
  END IF;

  SELECT role, name, vessel_id
    INTO actor_role, actor_name, actor_vessel_id
  FROM public.users
  WHERE id = actor_id;

  IF actor_role IS NULL THEN
    RAISE EXCEPTION 'A valid user profile is required';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id <> actor_id OR NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Sea-mile entries must be created as your own draft';
    END IF;

    NEW.owner_name := actor_name;
    NEW.review_vessel_id := NULL;
    NEW.decline_comment := NULL;
    NEW.submitted_at := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewer_name := NULL;
    NEW.reviewer_signature_type := NULL;
    NEW.reviewer_signature_image := NULL;
    NEW.reviewer_typed_name := NULL;
    NEW.reviewed_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id
    OR NEW.user_id <> OLD.user_id
    OR NEW.owner_name <> OLD.owner_name
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'The owner and identity of a sea-mile entry cannot be changed';
  END IF;

  IF OLD.status = 'APPROVED' THEN
    RAISE EXCEPTION 'Approved sea-mile entries are permanently locked';
  END IF;

  -- A Captain/MOV may review any pending entry assigned to their vessel,
  -- including their own personal sea-mile entry.
  IF OLD.status = 'PENDING'
    AND actor_role = 'CAPTAIN_MOV'
    AND actor_vessel_id = OLD.review_vessel_id THEN
    IF NEW.status NOT IN ('PENDING', 'APPROVED', 'DECLINED') THEN
      RAISE EXCEPTION 'Captain/MOV may only review pending sea-mile entries';
    END IF;
    IF NEW.review_vessel_id IS DISTINCT FROM OLD.review_vessel_id THEN
      RAISE EXCEPTION 'The reviewing vessel cannot be changed';
    END IF;

    IF NEW.status = 'PENDING' THEN
      NEW.decline_comment := NULL;
      NEW.reviewed_by := NULL;
      NEW.reviewer_name := NULL;
      NEW.reviewer_signature_type := NULL;
      NEW.reviewer_signature_image := NULL;
      NEW.reviewer_typed_name := NULL;
      NEW.reviewed_at := NULL;
    ELSIF NEW.status = 'APPROVED' THEN
      SELECT * INTO signature_row
      FROM public.user_signatures
      WHERE user_id = actor_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Set up your e-signature before approving sea miles';
      END IF;

      NEW.decline_comment := NULL;
      NEW.reviewed_by := actor_id;
      NEW.reviewer_name := actor_name;
      NEW.reviewer_signature_type := signature_row.signature_type;
      NEW.reviewer_signature_image := signature_row.signature_image;
      NEW.reviewer_typed_name := signature_row.typed_name;
      NEW.reviewed_at := now();
    ELSE
      IF nullif(trim(NEW.decline_comment), '') IS NULL THEN
        RAISE EXCEPTION 'A reason is required when declining sea miles';
      END IF;
      NEW.reviewed_by := actor_id;
      NEW.reviewer_name := actor_name;
      NEW.reviewer_signature_type := NULL;
      NEW.reviewer_signature_image := NULL;
      NEW.reviewer_typed_name := NULL;
      NEW.reviewed_at := now();
    END IF;

    RETURN NEW;
  END IF;

  IF actor_id = OLD.user_id THEN
    IF OLD.status NOT IN ('DRAFT', 'DECLINED') OR NEW.status NOT IN ('DRAFT', 'PENDING') THEN
      RAISE EXCEPTION 'Only draft or declined entries can be edited and resubmitted';
    END IF;

    NEW.reviewed_by := NULL;
    NEW.reviewer_name := NULL;
    NEW.reviewer_signature_type := NULL;
    NEW.reviewer_signature_image := NULL;
    NEW.reviewer_typed_name := NULL;
    NEW.reviewed_at := NULL;

    IF NEW.status = 'PENDING' THEN
      IF actor_vessel_id IS NULL THEN
        RAISE EXCEPTION 'Join a vessel before submitting sea miles for review';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.users captain
        WHERE captain.vessel_id = actor_vessel_id
          AND captain.role = 'CAPTAIN_MOV'
      ) THEN
        RAISE EXCEPTION 'This vessel does not currently have a Captain/MOV to review sea miles';
      END IF;

      NEW.review_vessel_id := actor_vessel_id;
      NEW.submitted_at := now();
      NEW.decline_comment := NULL;
    ELSE
      NEW.review_vessel_id := NULL;
      NEW.submitted_at := NULL;
      NEW.decline_comment := NULL;
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'You do not have permission to change this sea-mile entry';
END;
$$;

DROP TRIGGER IF EXISTS enforce_sea_mile_entry_integrity_trigger ON public.sea_mile_entries;
CREATE TRIGGER enforce_sea_mile_entry_integrity_trigger
  BEFORE INSERT OR UPDATE ON public.sea_mile_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_sea_mile_entry_integrity();

DROP TRIGGER IF EXISTS update_sea_mile_entries_updated_at ON public.sea_mile_entries;
CREATE TRIGGER update_sea_mile_entries_updated_at
  BEFORE UPDATE ON public.sea_mile_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.sea_mile_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners and reviewing Captains read sea miles" ON public.sea_mile_entries;
CREATE POLICY "Owners and reviewing Captains read sea miles"
  ON public.sea_mile_entries FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      review_vessel_id IS NOT NULL
      AND public.current_user_is_captain_of(review_vessel_id)
    )
  );

DROP POLICY IF EXISTS "Owners create sea-mile drafts" ON public.sea_mile_entries;
CREATE POLICY "Owners create sea-mile drafts"
  ON public.sea_mile_entries FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'DRAFT');

DROP POLICY IF EXISTS "Owners update editable sea miles" ON public.sea_mile_entries;
CREATE POLICY "Owners update editable sea miles"
  ON public.sea_mile_entries FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status IN ('DRAFT', 'DECLINED'))
  WITH CHECK (user_id = auth.uid() AND status IN ('DRAFT', 'PENDING'));

DROP POLICY IF EXISTS "Captains review pending sea miles" ON public.sea_mile_entries;
CREATE POLICY "Captains review pending sea miles"
  ON public.sea_mile_entries FOR UPDATE TO authenticated
  USING (
    status = 'PENDING'
    AND review_vessel_id IS NOT NULL
    AND public.current_user_is_captain_of(review_vessel_id)
  )
  WITH CHECK (
    status IN ('PENDING', 'APPROVED', 'DECLINED')
    AND review_vessel_id IS NOT NULL
    AND public.current_user_is_captain_of(review_vessel_id)
  );

DROP POLICY IF EXISTS "Owners delete editable sea miles" ON public.sea_mile_entries;
CREATE POLICY "Owners delete editable sea miles"
  ON public.sea_mile_entries FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status IN ('DRAFT', 'DECLINED'));

REVOKE ALL ON TABLE public.sea_mile_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sea_mile_entries TO authenticated;
