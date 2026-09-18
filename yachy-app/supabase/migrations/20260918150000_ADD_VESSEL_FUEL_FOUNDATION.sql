-- Shared vessel-fuel data foundation.
--
-- This is intentionally additive: the legacy public.fuel_logs table and its
-- historical rows remain untouched. New tank allocations live in a child table
-- so a Fuel Log can gradually opt into tank-level accounting without requiring
-- a backfill of earlier, unallocated fuel records.

-- Preserve the meaning and values of the legacy amount/price columns. Widen
-- amount_of_fuel by one decimal place because tank allocations and the new UI
-- accept three-decimal volumes; this is lossless for every existing value and
-- prevents a parent/child mismatch after PostgreSQL rounds a new entry.
ALTER TABLE public.fuel_logs
  ADD COLUMN IF NOT EXISTS volume_unit TEXT,
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS comment TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_by UUID DEFAULT auth.uid();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'fuel_logs'
      AND column_name = 'amount_of_fuel'
      AND (numeric_precision IS DISTINCT FROM 14 OR numeric_scale IS DISTINCT FROM 3)
  ) THEN
    EXECUTE $sql$
      ALTER TABLE public.fuel_logs
        ALTER COLUMN amount_of_fuel TYPE NUMERIC(14, 3)
        USING amount_of_fuel::NUMERIC(14, 3)
    $sql$;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fuel_logs_volume_unit_check'
      AND conrelid = 'public.fuel_logs'::regclass
  ) THEN
    ALTER TABLE public.fuel_logs
      ADD CONSTRAINT fuel_logs_volume_unit_check
      CHECK (volume_unit IS NULL OR volume_unit IN ('LITRES', 'US_GALLONS'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fuel_logs_currency_code_check'
      AND conrelid = 'public.fuel_logs'::regclass
  ) THEN
    ALTER TABLE public.fuel_logs
      ADD CONSTRAINT fuel_logs_currency_code_check
      CHECK (currency_code ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fuel_logs_comment_length_check'
      AND conrelid = 'public.fuel_logs'::regclass
  ) THEN
    ALTER TABLE public.fuel_logs
      ADD CONSTRAINT fuel_logs_comment_length_check
      CHECK (char_length(comment) <= 2000);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fuel_logs_created_by_fkey'
      AND conrelid = 'public.fuel_logs'::regclass
  ) THEN
    ALTER TABLE public.fuel_logs
      ADD CONSTRAINT fuel_logs_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- New fuel-log attribution is always derived from the authenticated profile.
-- Historical rows deliberately remain nullable because their actor UUID cannot
-- be reconstructed safely from a free-text name alone.
CREATE OR REPLACE FUNCTION public.enforce_fuel_log_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_name TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Allow the FK's ON DELETE SET NULL action after the actor profile is gone;
    -- every client-originated attempt to rewrite attribution remains ignored.
    IF NEW.created_by IS NULL
      AND OLD.created_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.created_by) THEN
      NEW.created_by_name := OLD.created_by_name;
      RETURN NEW;
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_by_name := OLD.created_by_name;
    RETURN NEW;
  END IF;

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to create a fuel log';
  END IF;

  SELECT name INTO actor_name
  FROM public.users
  WHERE id = actor_id;

  IF actor_name IS NULL THEN
    RAISE EXCEPTION 'A valid user profile is required to create a fuel log';
  END IF;

  NEW.created_by := actor_id;
  NEW.created_by_name := actor_name;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_fuel_log_actor() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_fuel_log_actor ON public.fuel_logs;
CREATE TRIGGER enforce_fuel_log_actor
  BEFORE INSERT OR UPDATE OF created_by, created_by_name
  ON public.fuel_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fuel_log_actor();

CREATE TABLE IF NOT EXISTS public.vessel_fuel_settings (
  vessel_id UUID PRIMARY KEY REFERENCES public.vessels(id) ON DELETE CASCADE,
  volume_unit TEXT NOT NULL DEFAULT 'LITRES',
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vessel_fuel_settings_volume_unit_check
    CHECK (volume_unit IN ('LITRES', 'US_GALLONS'))
);

CREATE TABLE IF NOT EXISTS public.fuel_tanks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  -- Litres are the canonical persisted unit. The vessel setting controls
  -- presentation and client conversion, avoiding mixed-unit arithmetic.
  capacity_litres NUMERIC(14, 3) NOT NULL,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fuel_tanks_name_present_check
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT fuel_tanks_location_length_check
    CHECK (char_length(location) <= 240),
  CONSTRAINT fuel_tanks_description_length_check
    CHECK (char_length(description) <= 2000),
  CONSTRAINT fuel_tanks_capacity_litres_check
    CHECK (capacity_litres > 0)
);

-- A single, vessel-wide display unit is sufficient because capacities and
-- movements are always persisted in canonical litres. Vessel capacity is
-- deliberately derived as SUM(fuel_tanks.capacity_litres), not duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS fuel_tanks_vessel_normalized_name_key
  ON public.fuel_tanks (vessel_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS fuel_tanks_vessel_id_idx
  ON public.fuel_tanks (vessel_id, created_at);

-- Setup and tank creators follow the same retained-audit semantics as fuel logs:
-- new actors are authenticated profiles, attribution cannot be rewritten, and
-- deleting a profile clears only its UUID rather than deleting fuel records.
ALTER TABLE public.vessel_fuel_settings
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.fuel_tanks
  ALTER COLUMN created_by DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vessel_fuel_settings_created_by_fkey'
      AND conrelid = 'public.vessel_fuel_settings'::regclass
  ) THEN
    ALTER TABLE public.vessel_fuel_settings
      ADD CONSTRAINT vessel_fuel_settings_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fuel_tanks_created_by_fkey'
      AND conrelid = 'public.fuel_tanks'::regclass
  ) THEN
    ALTER TABLE public.fuel_tanks
      ADD CONSTRAINT fuel_tanks_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_fuel_setup_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.vessel_id IS DISTINCT FROM OLD.vessel_id THEN
      RAISE EXCEPTION 'Fuel setup records cannot be moved between vessels';
    END IF;
    IF NEW.created_by IS NULL
      AND OLD.created_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.created_by) THEN
      RETURN NEW;
    END IF;
    NEW.created_by := OLD.created_by;
    RETURN NEW;
  END IF;

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to create fuel setup records';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = actor_id) THEN
    RAISE EXCEPTION 'A valid user profile is required to create fuel setup records';
  END IF;

  NEW.created_by := actor_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_fuel_setup_actor() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_fuel_setup_actor ON public.vessel_fuel_settings;
CREATE TRIGGER enforce_fuel_setup_actor
  BEFORE INSERT OR UPDATE OF created_by, vessel_id
  ON public.vessel_fuel_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fuel_setup_actor();

DROP TRIGGER IF EXISTS enforce_fuel_setup_actor ON public.fuel_tanks;
CREATE TRIGGER enforce_fuel_setup_actor
  BEFORE INSERT OR UPDATE OF created_by, vessel_id
  ON public.fuel_tanks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fuel_setup_actor();

CREATE TABLE IF NOT EXISTS public.fuel_log_tank_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  fuel_log_id UUID NOT NULL REFERENCES public.fuel_logs(id) ON DELETE CASCADE,
  fuel_tank_id UUID NOT NULL REFERENCES public.fuel_tanks(id) ON DELETE RESTRICT,
  amount_litres NUMERIC(14, 3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fuel_log_tank_entries_amount_litres_check
    CHECK (amount_litres > 0),
  CONSTRAINT fuel_log_tank_entries_one_tank_per_log_key
    UNIQUE (fuel_log_id, fuel_tank_id)
);

CREATE INDEX IF NOT EXISTS fuel_log_tank_entries_vessel_log_idx
  ON public.fuel_log_tank_entries (vessel_id, fuel_log_id);
CREATE INDEX IF NOT EXISTS fuel_log_tank_entries_tank_idx
  ON public.fuel_log_tank_entries (fuel_tank_id);

CREATE TABLE IF NOT EXISTS public.fuel_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  source_tank_id UUID NOT NULL REFERENCES public.fuel_tanks(id) ON DELETE RESTRICT,
  destination_tank_id UUID NOT NULL REFERENCES public.fuel_tanks(id) ON DELETE RESTRICT,
  amount_litres NUMERIC(14, 3) NOT NULL,
  transfer_date DATE NOT NULL,
  transfer_time TIME WITHOUT TIME ZONE NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  -- Nullable only so a retained audit record can survive profile deletion.
  -- New rows are still required to have an authenticated actor by trigger.
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fuel_transfers_distinct_tanks_check
    CHECK (source_tank_id <> destination_tank_id),
  CONSTRAINT fuel_transfers_amount_litres_check
    CHECK (amount_litres > 0),
  CONSTRAINT fuel_transfers_location_length_check
    CHECK (char_length(location) <= 240),
  CONSTRAINT fuel_transfers_notes_length_check
    CHECK (char_length(notes) <= 2000)
);

-- Keep transfer attribution aligned with fuel-log attribution: the server owns
-- the actor value, updates cannot rewrite it, and deleting a profile preserves
-- the operational record while clearing the unverifiable actor UUID.
ALTER TABLE public.fuel_transfers
  ALTER COLUMN created_by DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fuel_transfers_created_by_fkey'
      AND conrelid = 'public.fuel_transfers'::regclass
  ) THEN
    ALTER TABLE public.fuel_transfers
      ADD CONSTRAINT fuel_transfers_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_fuel_transfer_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id UUID := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Permit only the FK's profile-deletion cleanup; clients cannot clear or
    -- substitute the immutable authenticated creator.
    IF NEW.created_by IS NULL
      AND OLD.created_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.created_by) THEN
      RETURN NEW;
    END IF;
    NEW.created_by := OLD.created_by;
    RETURN NEW;
  END IF;

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required to create a fuel transfer';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = actor_id) THEN
    RAISE EXCEPTION 'A valid user profile is required to create a fuel transfer';
  END IF;

  NEW.created_by := actor_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_fuel_transfer_actor() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_fuel_transfer_actor ON public.fuel_transfers;
CREATE TRIGGER enforce_fuel_transfer_actor
  BEFORE INSERT OR UPDATE OF created_by
  ON public.fuel_transfers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fuel_transfer_actor();

CREATE INDEX IF NOT EXISTS fuel_transfers_vessel_date_idx
  ON public.fuel_transfers (vessel_id, transfer_date DESC, transfer_time DESC);
CREATE INDEX IF NOT EXISTS fuel_transfers_source_tank_idx
  ON public.fuel_transfers (source_tank_id);
CREATE INDEX IF NOT EXISTS fuel_transfers_destination_tank_idx
  ON public.fuel_transfers (destination_tank_id);

-- Keep tenant IDs on child records honest. Direct foreign keys alone cannot
-- prove that a selected tank and parent fuel log belong to the same vessel.
CREATE OR REPLACE FUNCTION public.validate_fuel_log_tank_entry_vessel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.fuel_logs AS fuel_log
    WHERE fuel_log.id = NEW.fuel_log_id
      AND fuel_log.vessel_id = NEW.vessel_id
  ) THEN
    RAISE EXCEPTION 'Fuel log must belong to the fuel tank entry vessel';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.fuel_tanks AS fuel_tank
    WHERE fuel_tank.id = NEW.fuel_tank_id
      AND fuel_tank.vessel_id = NEW.vessel_id
  ) THEN
    RAISE EXCEPTION 'Fuel tank must belong to the fuel tank entry vessel';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_fuel_log_tank_entry_vessel() FROM PUBLIC;

DROP TRIGGER IF EXISTS validate_fuel_log_tank_entry_vessel ON public.fuel_log_tank_entries;
CREATE TRIGGER validate_fuel_log_tank_entry_vessel
  BEFORE INSERT OR UPDATE OF vessel_id, fuel_log_id, fuel_tank_id
  ON public.fuel_log_tank_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_fuel_log_tank_entry_vessel();

CREATE OR REPLACE FUNCTION public.validate_fuel_transfer_tanks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_tank_ids UUID[];
  excluded_transfer_id UUID;
  replacement_source_tank_id UUID;
  replacement_destination_tank_id UUID;
  replacement_amount_litres NUMERIC(14, 3);
  affected_tank RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A vessel delete cascades every transfer and allocation. Skip per-row
    -- ledger checks once the parent vessel is gone because the whole ledger is
    -- being removed, not edited.
    IF NOT EXISTS (SELECT 1 FROM public.vessels WHERE id = OLD.vessel_id) THEN
      RETURN OLD;
    END IF;
    affected_tank_ids := ARRAY[OLD.source_tank_id, OLD.destination_tank_id];
    excluded_transfer_id := OLD.id;
  ELSIF TG_OP = 'UPDATE' THEN
    affected_tank_ids := ARRAY[
      OLD.source_tank_id,
      OLD.destination_tank_id,
      NEW.source_tank_id,
      NEW.destination_tank_id
    ];
    excluded_transfer_id := OLD.id;
    replacement_source_tank_id := NEW.source_tank_id;
    replacement_destination_tank_id := NEW.destination_tank_id;
    replacement_amount_litres := NEW.amount_litres;
  ELSE
    affected_tank_ids := ARRAY[NEW.source_tank_id, NEW.destination_tank_id];
    replacement_source_tank_id := NEW.source_tank_id;
    replacement_destination_tank_id := NEW.destination_tank_id;
    replacement_amount_litres := NEW.amount_litres;
  END IF;

  -- Lock every tank whose recorded balance is affected by this write. Ordering
  -- by ID makes concurrent cross-tank transfers serialize without deadlock.
  PERFORM 1
  FROM public.fuel_tanks
  WHERE id = ANY(affected_tank_ids)
  ORDER BY id
  FOR UPDATE;

  IF TG_OP <> 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.fuel_tanks AS source_tank
      WHERE source_tank.id = NEW.source_tank_id
        AND source_tank.vessel_id = NEW.vessel_id
    ) THEN
      RAISE EXCEPTION 'Source tank must belong to the transfer vessel';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.fuel_tanks AS destination_tank
      WHERE destination_tank.id = NEW.destination_tank_id
        AND destination_tank.vessel_id = NEW.vessel_id
    ) THEN
      RAISE EXCEPTION 'Destination tank must belong to the transfer vessel';
    END IF;
  END IF;

  -- Evaluate every old and new endpoint against the complete post-write ledger.
  -- This catches downstream dependencies, such as reducing or deleting A -> B
  -- after B has already supplied a later B -> C transfer.
  FOR affected_tank IN
    SELECT
      tank.id,
      tank.capacity_litres,
      COALESCE((
        SELECT SUM(entry.amount_litres)
        FROM public.fuel_log_tank_entries AS entry
        WHERE entry.fuel_tank_id = tank.id
      ), 0)
      + COALESCE((
        SELECT SUM(
          CASE
            WHEN transfer.destination_tank_id = tank.id THEN transfer.amount_litres
            WHEN transfer.source_tank_id = tank.id THEN -transfer.amount_litres
            ELSE 0
          END
        )
        FROM public.fuel_transfers AS transfer
        WHERE (transfer.source_tank_id = tank.id OR transfer.destination_tank_id = tank.id)
          AND (excluded_transfer_id IS NULL OR transfer.id <> excluded_transfer_id)
      ), 0)
      + CASE
          WHEN tank.id = replacement_destination_tank_id THEN replacement_amount_litres
          ELSE 0
        END
      - CASE
          WHEN tank.id = replacement_source_tank_id THEN replacement_amount_litres
          ELSE 0
        END AS recorded_balance
    FROM public.fuel_tanks AS tank
    WHERE tank.id = ANY(affected_tank_ids)
  LOOP
    IF affected_tank.recorded_balance < 0 THEN
      IF TG_OP <> 'DELETE' AND affected_tank.id = NEW.source_tank_id THEN
        RAISE EXCEPTION 'Transfer amount exceeds the recorded source tank balance';
      END IF;
      RAISE EXCEPTION 'Transfer change would leave a tank recorded balance negative';
    END IF;

    IF affected_tank.recorded_balance > affected_tank.capacity_litres THEN
      IF TG_OP <> 'DELETE' AND affected_tank.id = NEW.destination_tank_id THEN
        RAISE EXCEPTION 'Transfer amount exceeds destination tank capacity';
      END IF;
      RAISE EXCEPTION 'Transfer change would exceed a tank capacity';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_fuel_transfer_tanks() FROM PUBLIC;

DROP TRIGGER IF EXISTS validate_fuel_transfer_tanks ON public.fuel_transfers;
CREATE TRIGGER validate_fuel_transfer_tanks
  BEFORE INSERT OR UPDATE OF vessel_id, source_tank_id, destination_tank_id, amount_litres OR DELETE
  ON public.fuel_transfers
  FOR EACH ROW EXECUTE FUNCTION public.validate_fuel_transfer_tanks();

-- Check allocation deltas before they are applied. The tank-aware update RPC
-- upserts its requested final values before deleting omitted entries, so every
-- row-level check sees the correct final value for the tank it affects.
CREATE OR REPLACE FUNCTION public.validate_fuel_log_tank_entry_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_tank_ids UUID[];
  affected_vessel_id UUID;
  excluded_entry_id UUID;
  replacement_tank_id UUID;
  replacement_amount_litres NUMERIC(14, 3);
  affected_tank RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    affected_tank_ids := ARRAY[NEW.fuel_tank_id];
    affected_vessel_id := NEW.vessel_id;
    replacement_tank_id := NEW.fuel_tank_id;
    replacement_amount_litres := NEW.amount_litres;
  ELSIF TG_OP = 'DELETE' THEN
    affected_tank_ids := ARRAY[OLD.fuel_tank_id];
    affected_vessel_id := OLD.vessel_id;
    excluded_entry_id := OLD.id;
  ELSE
    affected_tank_ids := ARRAY[OLD.fuel_tank_id, NEW.fuel_tank_id];
    affected_vessel_id := OLD.vessel_id;
    excluded_entry_id := OLD.id;
    replacement_tank_id := NEW.fuel_tank_id;
    replacement_amount_litres := NEW.amount_litres;
  END IF;

  -- A vessel delete removes all logs, allocations, transfers, and tanks. Its
  -- cascading intermediate row order must not be mistaken for a ledger edit.
  IF NOT EXISTS (SELECT 1 FROM public.vessels WHERE id = affected_vessel_id) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM public.fuel_tanks
  WHERE id = ANY(affected_tank_ids)
  ORDER BY id
  FOR UPDATE;

  FOR affected_tank IN
    SELECT
      tank.id,
      tank.capacity_litres,
      COALESCE((
        SELECT SUM(entry.amount_litres)
        FROM public.fuel_log_tank_entries AS entry
        WHERE entry.fuel_tank_id = tank.id
          AND (excluded_entry_id IS NULL OR entry.id <> excluded_entry_id)
      ), 0)
      + CASE
          WHEN tank.id = replacement_tank_id THEN replacement_amount_litres
          ELSE 0
        END
      + COALESCE((
        SELECT SUM(
          CASE
            WHEN transfer.destination_tank_id = tank.id THEN transfer.amount_litres
            WHEN transfer.source_tank_id = tank.id THEN -transfer.amount_litres
            ELSE 0
          END
        )
        FROM public.fuel_transfers AS transfer
        WHERE transfer.source_tank_id = tank.id
           OR transfer.destination_tank_id = tank.id
      ), 0) AS recorded_balance
    FROM public.fuel_tanks AS tank
    WHERE tank.id = ANY(affected_tank_ids)
  LOOP
    IF affected_tank.recorded_balance < 0 THEN
      RAISE EXCEPTION 'Fuel log allocation change would leave a tank recorded balance negative';
    END IF;
    IF affected_tank.recorded_balance > affected_tank.capacity_litres THEN
      RAISE EXCEPTION 'Fuel log allocation would exceed tank capacity';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_fuel_log_tank_entry_balance() FROM PUBLIC;

DROP TRIGGER IF EXISTS validate_fuel_log_tank_entry_state ON public.fuel_log_tank_entries;
DROP TRIGGER IF EXISTS validate_fuel_log_tank_entry_balance ON public.fuel_log_tank_entries;
CREATE TRIGGER validate_fuel_log_tank_entry_balance
  BEFORE INSERT OR UPDATE OF vessel_id, fuel_log_id, fuel_tank_id, amount_litres OR DELETE
  ON public.fuel_log_tank_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_fuel_log_tank_entry_balance();

CREATE OR REPLACE FUNCTION public.validate_fuel_log_parent_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  allocation_count BIGINT;
  allocation_litres NUMERIC;
  allocations_match_vessel BOOLEAN;
  expected_litres NUMERIC;
BEGIN
  SELECT
    count(*),
    COALESCE(SUM(entry.amount_litres), 0),
    COALESCE(bool_and(entry.vessel_id = NEW.vessel_id), TRUE)
  INTO allocation_count, allocation_litres, allocations_match_vessel
  FROM public.fuel_log_tank_entries AS entry
  WHERE entry.fuel_log_id = NEW.id;

  -- Rows without allocations are legacy-compatible and continue to support the
  -- original direct update path. Once allocations exist, tank-defining parent
  -- fields must describe those final child rows exactly.
  IF allocation_count = 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.volume_unit NOT IN ('LITRES', 'US_GALLONS') OR NOT allocations_match_vessel THEN
    RAISE EXCEPTION 'Tank-aware fuel log parent and allocations must remain synchronized';
  END IF;

  expected_litres := CASE
    WHEN NEW.volume_unit = 'LITRES' THEN NEW.amount_of_fuel
    ELSE NEW.amount_of_fuel * 3.785411784
  END;
  IF abs(allocation_litres - expected_litres) > 0.01 THEN
    RAISE EXCEPTION 'Tank-aware fuel log parent and allocations must remain synchronized';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_fuel_log_parent_state() FROM PUBLIC;

DROP TRIGGER IF EXISTS validate_fuel_log_parent_state ON public.fuel_logs;
CREATE TRIGGER validate_fuel_log_parent_state
  BEFORE UPDATE OF vessel_id, amount_of_fuel, volume_unit ON public.fuel_logs
  FOR EACH ROW EXECUTE FUNCTION public.validate_fuel_log_parent_state();

CREATE OR REPLACE FUNCTION public.validate_fuel_tank_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  recorded_balance NUMERIC;
BEGIN
  SELECT
    COALESCE((
      SELECT SUM(entry.amount_litres)
      FROM public.fuel_log_tank_entries AS entry
      WHERE entry.fuel_tank_id = OLD.id
    ), 0)
    + COALESCE((
      SELECT SUM(
        CASE
          WHEN transfer.destination_tank_id = OLD.id THEN transfer.amount_litres
          WHEN transfer.source_tank_id = OLD.id THEN -transfer.amount_litres
          ELSE 0
        END
      )
      FROM public.fuel_transfers AS transfer
      WHERE transfer.source_tank_id = OLD.id
         OR transfer.destination_tank_id = OLD.id
    ), 0)
  INTO recorded_balance;

  IF NEW.capacity_litres < recorded_balance THEN
    RAISE EXCEPTION 'Fuel tank capacity cannot be lower than its recorded balance';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_fuel_tank_capacity() FROM PUBLIC;

DROP TRIGGER IF EXISTS validate_fuel_tank_capacity ON public.fuel_tanks;
CREATE TRIGGER validate_fuel_tank_capacity
  BEFORE UPDATE OF capacity_litres ON public.fuel_tanks
  FOR EACH ROW EXECUTE FUNCTION public.validate_fuel_tank_capacity();

-- Reuse the repository's standard updated_at function. The production baseline
-- and existing timestamped migrations install it before this migration.
DROP TRIGGER IF EXISTS update_vessel_fuel_settings_updated_at ON public.vessel_fuel_settings;
CREATE TRIGGER update_vessel_fuel_settings_updated_at
  BEFORE UPDATE ON public.vessel_fuel_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_fuel_tanks_updated_at ON public.fuel_tanks;
CREATE TRIGGER update_fuel_tanks_updated_at
  BEFORE UPDATE ON public.fuel_tanks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_fuel_transfers_updated_at ON public.fuel_transfers;
CREATE TRIGGER update_fuel_transfers_updated_at
  BEFORE UPDATE ON public.fuel_transfers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Saves the vessel-level setup atomically. It is SECURITY INVOKER on purpose:
-- the caller's normal RLS policies remain in force in addition to the explicit
-- HOD/Captain authorization check below. Tank IDs omitted from p_tanks are the
-- requested deletion set; any historical log/transfer reference blocks the
-- delete via ON DELETE RESTRICT and rolls back the entire transaction.
CREATE OR REPLACE FUNCTION public.save_vessel_fuel_setup(
  p_vessel_id UUID,
  p_volume_unit TEXT,
  p_tanks JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  saved_setup JSONB;
BEGIN
  IF p_vessel_id IS NULL OR NOT public.current_user_can_manage_vessel(p_vessel_id) THEN
    RAISE EXCEPTION 'Only an HOD or Captain/MOV can save vessel fuel setup';
  END IF;

  IF p_volume_unit NOT IN ('LITRES', 'US_GALLONS') THEN
    RAISE EXCEPTION 'Fuel volume unit must be LITRES or US_GALLONS';
  END IF;

  IF p_tanks IS NULL OR jsonb_typeof(p_tanks) <> 'array' THEN
    RAISE EXCEPTION 'Fuel tanks must be supplied as an array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_tanks) AS input(
      id UUID,
      name TEXT,
      location TEXT,
      description TEXT,
      capacity_litres NUMERIC
    )
    WHERE name IS NULL
      OR char_length(btrim(name)) NOT BETWEEN 1 AND 120
      OR COALESCE(char_length(location), 0) > 240
      OR COALESCE(char_length(description), 0) > 2000
      OR capacity_litres IS NULL
      OR capacity_litres <= 0
  ) THEN
    RAISE EXCEPTION 'Every fuel tank requires a name and positive capacity';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT id
      FROM jsonb_to_recordset(p_tanks) AS input(
        id UUID,
        name TEXT,
        location TEXT,
        description TEXT,
        capacity_litres NUMERIC
      )
      WHERE id IS NOT NULL
      GROUP BY id
      HAVING count(*) > 1
    ) AS duplicate_ids
  ) THEN
    RAISE EXCEPTION 'Fuel setup contains duplicate tank IDs';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT lower(btrim(name)) AS normalized_name
      FROM jsonb_to_recordset(p_tanks) AS input(
        id UUID,
        name TEXT,
        location TEXT,
        description TEXT,
        capacity_litres NUMERIC
      )
      GROUP BY lower(btrim(name))
      HAVING count(*) > 1
    ) AS duplicate_names
  ) THEN
    RAISE EXCEPTION 'Fuel setup contains duplicate tank names';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_tanks) AS input(
      id UUID,
      name TEXT,
      location TEXT,
      description TEXT,
      capacity_litres NUMERIC
    )
    LEFT JOIN public.fuel_tanks AS existing
      ON existing.id = input.id
     AND existing.vessel_id = p_vessel_id
    WHERE input.id IS NOT NULL
      AND existing.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Fuel setup contains a tank that does not belong to this vessel';
  END IF;

  INSERT INTO public.vessel_fuel_settings (vessel_id, volume_unit)
  VALUES (p_vessel_id, p_volume_unit)
  ON CONFLICT (vessel_id) DO UPDATE
    SET volume_unit = EXCLUDED.volume_unit;

  -- Delete requested omissions before renaming retained tanks. Besides keeping
  -- new ID-less tanks safe, this permits a retained tank to adopt the name of
  -- an omitted, unreferenced tank without tripping the normalized-name index.
  DELETE FROM public.fuel_tanks AS existing
  WHERE existing.vessel_id = p_vessel_id
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_tanks) AS input(
        id UUID,
        name TEXT,
        location TEXT,
        description TEXT,
        capacity_litres NUMERIC
      )
      WHERE input.id = existing.id
    );

  -- Move every retained tank through a transaction-local unique placeholder
  -- before assigning final names. The normalized-name index is immediate, so
  -- a one-pass UPDATE cannot swap or rotate names (for example Port ↔
  -- Starboard) even though the requested final set is unique. These temporary
  -- values are never observable outside this atomic function call.
  UPDATE public.fuel_tanks AS existing
  SET name = '__fuel_setup_tmp__' || gen_random_uuid()::TEXT
  WHERE existing.vessel_id = p_vessel_id
    AND EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_tanks) AS input(
        id UUID,
        name TEXT,
        location TEXT,
        description TEXT,
        capacity_litres NUMERIC
      )
      WHERE input.id = existing.id
    );

  UPDATE public.fuel_tanks AS existing
  SET
    name = btrim(input.name),
    location = COALESCE(btrim(input.location), ''),
    description = COALESCE(btrim(input.description), ''),
    capacity_litres = input.capacity_litres
  FROM jsonb_to_recordset(p_tanks) AS input(
    id UUID,
    name TEXT,
    location TEXT,
    description TEXT,
    capacity_litres NUMERIC
  )
  WHERE input.id IS NOT NULL
    AND existing.id = input.id
    AND existing.vessel_id = p_vessel_id;

  INSERT INTO public.fuel_tanks (
    vessel_id, name, location, description, capacity_litres
  )
  SELECT
    p_vessel_id,
    btrim(input.name),
    COALESCE(btrim(input.location), ''),
    COALESCE(btrim(input.description), ''),
    input.capacity_litres
  FROM jsonb_to_recordset(p_tanks) AS input(
    id UUID,
    name TEXT,
    location TEXT,
    description TEXT,
    capacity_litres NUMERIC
  )
  WHERE input.id IS NULL;

  SELECT jsonb_build_object(
    'settings', (
      SELECT to_jsonb(settings)
      FROM public.vessel_fuel_settings AS settings
      WHERE settings.vessel_id = p_vessel_id
    ),
    'tanks', COALESCE((
      SELECT jsonb_agg(to_jsonb(tank) ORDER BY lower(tank.name), tank.id)
      FROM public.fuel_tanks AS tank
      WHERE tank.vessel_id = p_vessel_id
    ), '[]'::jsonb)
  )
  INTO saved_setup;

  RETURN saved_setup;
END;
$$;

REVOKE ALL ON FUNCTION public.save_vessel_fuel_setup(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_vessel_fuel_setup(UUID, TEXT, JSONB) TO authenticated;

-- New fuel-log screens save the legacy parent row and its per-tank allocations
-- together. Existing callers continue to use fuel_logs directly; these RPCs
-- are an additive path for the tank-aware UI only.
CREATE OR REPLACE FUNCTION public.create_fuel_log_with_tank_entries(
  p_log JSONB,
  p_entries JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vessel_id UUID := (p_log ->> 'vessel_id')::UUID;
  v_location TEXT := NULLIF(btrim(p_log ->> 'location_of_refueling'), '');
  v_log_date DATE := (p_log ->> 'log_date')::DATE;
  v_log_time TEXT := p_log ->> 'log_time';
  v_amount NUMERIC := (p_log ->> 'amount_of_fuel')::NUMERIC;
  v_price NUMERIC := (p_log ->> 'price_per_gallon')::NUMERIC;
  v_total NUMERIC := (p_log ->> 'total_price')::NUMERIC;
  v_volume_unit TEXT := p_log ->> 'volume_unit';
  v_currency_code TEXT := upper(COALESCE(NULLIF(btrim(p_log ->> 'currency_code'), ''), 'USD'));
  v_comment TEXT := COALESCE(btrim(p_log ->> 'comment'), '');
  v_expected_litres NUMERIC;
  v_entries_litres NUMERIC;
  v_log_row public.fuel_logs%ROWTYPE;
BEGIN
  IF p_log IS NULL OR jsonb_typeof(p_log) <> 'object' THEN
    RAISE EXCEPTION 'Fuel log must be supplied as an object';
  END IF;
  IF v_vessel_id IS NULL OR NOT public.current_user_can_access_vessel(v_vessel_id) THEN
    RAISE EXCEPTION 'Only active vessel members can create fuel logs';
  END IF;
  IF v_log_date IS NULL OR v_log_time IS NULL OR btrim(v_log_time) = '' OR v_amount IS NULL
    OR v_amount <= 0 OR v_price IS NULL OR v_price < 0 OR v_total IS NULL OR v_total < 0 THEN
    RAISE EXCEPTION 'Fuel log date, time, positive amount, and non-negative pricing are required';
  END IF;
  IF v_volume_unit NOT IN ('LITRES', 'US_GALLONS') THEN
    RAISE EXCEPTION 'New tank-aware fuel logs require a volume unit';
  END IF;
  IF v_currency_code !~ '^[A-Z]{3}$' OR char_length(v_comment) > 2000 THEN
    RAISE EXCEPTION 'Fuel log currency or comment is invalid';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'At least one tank allocation is required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_entries) AS entry(fuel_tank_id UUID, amount_litres NUMERIC)
    WHERE fuel_tank_id IS NULL OR amount_litres IS NULL OR amount_litres <= 0
  ) THEN
    RAISE EXCEPTION 'Every tank allocation requires a tank and positive amount';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT fuel_tank_id
      FROM jsonb_to_recordset(p_entries) AS entry(fuel_tank_id UUID, amount_litres NUMERIC)
      GROUP BY fuel_tank_id
      HAVING count(*) > 1
    ) AS duplicate_tanks
  ) THEN
    RAISE EXCEPTION 'A tank may only appear once in a fuel log';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_entries) AS entry(fuel_tank_id UUID, amount_litres NUMERIC)
    LEFT JOIN public.fuel_tanks AS tank
      ON tank.id = entry.fuel_tank_id
     AND tank.vessel_id = v_vessel_id
    WHERE tank.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Fuel log allocations must use tanks from the active vessel';
  END IF;

  SELECT COALESCE(SUM(entry.amount_litres), 0)
  INTO v_entries_litres
  FROM jsonb_to_recordset(p_entries) AS entry(fuel_tank_id UUID, amount_litres NUMERIC);
  v_expected_litres := CASE
    WHEN v_volume_unit = 'LITRES' THEN v_amount
    ELSE v_amount * 3.785411784
  END;
  IF abs(v_entries_litres - v_expected_litres) > 0.01 THEN
    RAISE EXCEPTION 'Fuel tank allocations must equal the fuel log amount';
  END IF;

  INSERT INTO public.fuel_logs (
    vessel_id, location_of_refueling, log_date, log_time, amount_of_fuel,
    price_per_gallon, total_price, volume_unit, currency_code, comment
  )
  VALUES (
    v_vessel_id, v_location, v_log_date, btrim(v_log_time), v_amount,
    v_price, v_total, v_volume_unit, v_currency_code, v_comment
  )
  RETURNING * INTO v_log_row;

  INSERT INTO public.fuel_log_tank_entries (
    vessel_id, fuel_log_id, fuel_tank_id, amount_litres
  )
  SELECT v_vessel_id, v_log_row.id, entry.fuel_tank_id, entry.amount_litres
  FROM jsonb_to_recordset(p_entries) AS entry(fuel_tank_id UUID, amount_litres NUMERIC);

  RETURN to_jsonb(v_log_row);
END;
$$;

REVOKE ALL ON FUNCTION public.create_fuel_log_with_tank_entries(JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_fuel_log_with_tank_entries(JSONB, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_fuel_log_with_tank_entries(
  p_fuel_log_id UUID,
  p_vessel_id UUID,
  p_log_patch JSONB,
  p_entries JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.fuel_logs%ROWTYPE;
  v_updated public.fuel_logs%ROWTYPE;
  v_location TEXT;
  v_log_date DATE;
  v_log_time TEXT;
  v_amount NUMERIC;
  v_price NUMERIC;
  v_total NUMERIC;
  v_volume_unit TEXT;
  v_currency_code TEXT;
  v_comment TEXT;
  v_expected_litres NUMERIC;
  v_entries_litres NUMERIC;
BEGIN
  IF p_fuel_log_id IS NULL OR p_vessel_id IS NULL
    OR NOT public.current_user_can_access_vessel(p_vessel_id) THEN
    RAISE EXCEPTION 'Only active vessel members can update fuel logs';
  END IF;
  IF p_log_patch IS NULL OR jsonb_typeof(p_log_patch) <> 'object' THEN
    RAISE EXCEPTION 'Fuel log update must be supplied as an object';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'At least one tank allocation is required';
  END IF;

  SELECT * INTO v_existing
  FROM public.fuel_logs
  WHERE id = p_fuel_log_id
    AND vessel_id = p_vessel_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fuel log was not found or access was denied';
  END IF;

  v_location := CASE WHEN p_log_patch ? 'location_of_refueling'
    THEN NULLIF(btrim(p_log_patch ->> 'location_of_refueling'), '')
    ELSE v_existing.location_of_refueling END;
  v_log_date := CASE WHEN p_log_patch ? 'log_date'
    THEN (p_log_patch ->> 'log_date')::DATE ELSE v_existing.log_date END;
  v_log_time := CASE WHEN p_log_patch ? 'log_time'
    THEN p_log_patch ->> 'log_time' ELSE v_existing.log_time END;
  v_amount := CASE WHEN p_log_patch ? 'amount_of_fuel'
    THEN (p_log_patch ->> 'amount_of_fuel')::NUMERIC ELSE v_existing.amount_of_fuel END;
  v_price := CASE WHEN p_log_patch ? 'price_per_gallon'
    THEN (p_log_patch ->> 'price_per_gallon')::NUMERIC ELSE v_existing.price_per_gallon END;
  v_total := CASE WHEN p_log_patch ? 'total_price'
    THEN (p_log_patch ->> 'total_price')::NUMERIC ELSE v_existing.total_price END;
  v_volume_unit := CASE WHEN p_log_patch ? 'volume_unit'
    THEN p_log_patch ->> 'volume_unit' ELSE v_existing.volume_unit END;
  v_currency_code := CASE WHEN p_log_patch ? 'currency_code'
    THEN upper(COALESCE(NULLIF(btrim(p_log_patch ->> 'currency_code'), ''), 'USD'))
    ELSE v_existing.currency_code END;
  v_comment := CASE WHEN p_log_patch ? 'comment'
    THEN COALESCE(btrim(p_log_patch ->> 'comment'), '') ELSE v_existing.comment END;

  IF v_log_date IS NULL OR v_log_time IS NULL OR btrim(v_log_time) = '' OR v_amount IS NULL
    OR v_amount <= 0 OR v_price IS NULL OR v_price < 0 OR v_total IS NULL OR v_total < 0 THEN
    RAISE EXCEPTION 'Fuel log date, time, positive amount, and non-negative pricing are required';
  END IF;
  IF v_volume_unit NOT IN ('LITRES', 'US_GALLONS') THEN
    RAISE EXCEPTION 'Tank-aware fuel logs require a volume unit';
  END IF;
  IF v_currency_code !~ '^[A-Z]{3}$' OR char_length(v_comment) > 2000 THEN
    RAISE EXCEPTION 'Fuel log currency or comment is invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_entries) AS entry(fuel_tank_id UUID, amount_litres NUMERIC)
    WHERE fuel_tank_id IS NULL OR amount_litres IS NULL OR amount_litres <= 0
  ) THEN
    RAISE EXCEPTION 'Every tank allocation requires a tank and positive amount';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT fuel_tank_id
      FROM jsonb_to_recordset(p_entries) AS entry(fuel_tank_id UUID, amount_litres NUMERIC)
      GROUP BY fuel_tank_id
      HAVING count(*) > 1
    ) AS duplicate_tanks
  ) THEN
    RAISE EXCEPTION 'A tank may only appear once in a fuel log';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_entries) AS entry(fuel_tank_id UUID, amount_litres NUMERIC)
    LEFT JOIN public.fuel_tanks AS tank
      ON tank.id = entry.fuel_tank_id
     AND tank.vessel_id = p_vessel_id
    WHERE tank.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Fuel log allocations must use tanks from the active vessel';
  END IF;

  SELECT COALESCE(SUM(entry.amount_litres), 0)
  INTO v_entries_litres
  FROM jsonb_to_recordset(p_entries) AS entry(fuel_tank_id UUID, amount_litres NUMERIC);
  v_expected_litres := CASE
    WHEN v_volume_unit = 'LITRES' THEN v_amount
    ELSE v_amount * 3.785411784
  END;
  IF abs(v_entries_litres - v_expected_litres) > 0.01 THEN
    RAISE EXCEPTION 'Fuel tank allocations must equal the fuel log amount';
  END IF;

  -- Apply requested allocation values first so the per-tank balance trigger can
  -- validate each actual delta without a transient delete-all state.
  INSERT INTO public.fuel_log_tank_entries (
    vessel_id, fuel_log_id, fuel_tank_id, amount_litres
  )
  SELECT p_vessel_id, p_fuel_log_id, entry.fuel_tank_id, entry.amount_litres
  FROM jsonb_to_recordset(p_entries) AS entry(fuel_tank_id UUID, amount_litres NUMERIC)
  ON CONFLICT (fuel_log_id, fuel_tank_id) DO UPDATE
    SET
      vessel_id = EXCLUDED.vessel_id,
      amount_litres = EXCLUDED.amount_litres;

  DELETE FROM public.fuel_log_tank_entries AS existing_entry
  WHERE existing_entry.fuel_log_id = p_fuel_log_id
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_entries) AS requested_entry(
        fuel_tank_id UUID,
        amount_litres NUMERIC
      )
      WHERE requested_entry.fuel_tank_id = existing_entry.fuel_tank_id
    );

  -- Parent fields are written last. The parent trigger now sees the final child
  -- rows and rejects any direct or legacy update that would desynchronize them.
  UPDATE public.fuel_logs
  SET
    location_of_refueling = v_location,
    log_date = v_log_date,
    log_time = btrim(v_log_time),
    amount_of_fuel = v_amount,
    price_per_gallon = v_price,
    total_price = v_total,
    volume_unit = v_volume_unit,
    currency_code = v_currency_code,
    comment = v_comment
  WHERE id = p_fuel_log_id
  RETURNING * INTO v_updated;

  RETURN to_jsonb(v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.update_fuel_log_with_tank_entries(UUID, UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_fuel_log_with_tank_entries(UUID, UUID, JSONB, JSONB) TO authenticated;

ALTER TABLE public.vessel_fuel_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_tanks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_log_tank_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_transfers ENABLE ROW LEVEL SECURITY;

-- Setup is shared/readable by the vessel so members can select tanks in log
-- and transfer flows, but its settings and tank definitions are HOD/Captain-only.
DROP POLICY IF EXISTS "Vessel members read fuel settings" ON public.vessel_fuel_settings;
CREATE POLICY "Vessel members read fuel settings"
  ON public.vessel_fuel_settings FOR SELECT TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id));

DROP POLICY IF EXISTS "HOD and Captain create fuel settings" ON public.vessel_fuel_settings;
CREATE POLICY "HOD and Captain create fuel settings"
  ON public.vessel_fuel_settings FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_can_manage_vessel(vessel_id)
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "HOD and Captain update fuel settings" ON public.vessel_fuel_settings;
CREATE POLICY "HOD and Captain update fuel settings"
  ON public.vessel_fuel_settings FOR UPDATE TO authenticated
  USING (public.current_user_can_manage_vessel(vessel_id))
  WITH CHECK (public.current_user_can_manage_vessel(vessel_id));

DROP POLICY IF EXISTS "HOD and Captain delete fuel settings" ON public.vessel_fuel_settings;
CREATE POLICY "HOD and Captain delete fuel settings"
  ON public.vessel_fuel_settings FOR DELETE TO authenticated
  USING (public.current_user_can_manage_vessel(vessel_id));

DROP POLICY IF EXISTS "Vessel members read fuel tanks" ON public.fuel_tanks;
CREATE POLICY "Vessel members read fuel tanks"
  ON public.fuel_tanks FOR SELECT TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id));

DROP POLICY IF EXISTS "HOD and Captain create fuel tanks" ON public.fuel_tanks;
CREATE POLICY "HOD and Captain create fuel tanks"
  ON public.fuel_tanks FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_can_manage_vessel(vessel_id)
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "HOD and Captain update fuel tanks" ON public.fuel_tanks;
CREATE POLICY "HOD and Captain update fuel tanks"
  ON public.fuel_tanks FOR UPDATE TO authenticated
  USING (public.current_user_can_manage_vessel(vessel_id))
  WITH CHECK (public.current_user_can_manage_vessel(vessel_id));

DROP POLICY IF EXISTS "HOD and Captain delete fuel tanks" ON public.fuel_tanks;
CREATE POLICY "HOD and Captain delete fuel tanks"
  ON public.fuel_tanks FOR DELETE TO authenticated
  USING (public.current_user_can_manage_vessel(vessel_id));

-- Allocations are readable by vessel members, but all mutations are confined
-- to the validated SECURITY DEFINER RPCs above. This prevents a client from
-- bypassing parent-total reconciliation with a direct child-table write.
DROP POLICY IF EXISTS "Vessel members manage fuel log tank entries" ON public.fuel_log_tank_entries;
DROP POLICY IF EXISTS "Vessel members read fuel log tank entries" ON public.fuel_log_tank_entries;
CREATE POLICY "Vessel members read fuel log tank entries"
  ON public.fuel_log_tank_entries FOR SELECT TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id));

DROP POLICY IF EXISTS "Vessel members read fuel transfers" ON public.fuel_transfers;
CREATE POLICY "Vessel members read fuel transfers"
  ON public.fuel_transfers FOR SELECT TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id));

DROP POLICY IF EXISTS "Vessel members create fuel transfers" ON public.fuel_transfers;
CREATE POLICY "Vessel members create fuel transfers"
  ON public.fuel_transfers FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_can_access_vessel(vessel_id)
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "Vessel members update fuel transfers" ON public.fuel_transfers;
CREATE POLICY "Vessel members update fuel transfers"
  ON public.fuel_transfers FOR UPDATE TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id))
  WITH CHECK (public.current_user_can_access_vessel(vessel_id));

DROP POLICY IF EXISTS "Vessel members delete fuel transfers" ON public.fuel_transfers;
CREATE POLICY "Vessel members delete fuel transfers"
  ON public.fuel_transfers FOR DELETE TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id));

REVOKE ALL ON TABLE public.vessel_fuel_settings FROM anon;
REVOKE ALL ON TABLE public.fuel_tanks FROM anon;
REVOKE ALL ON TABLE public.fuel_log_tank_entries FROM anon;
REVOKE ALL ON TABLE public.fuel_transfers FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.fuel_log_tank_entries FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vessel_fuel_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fuel_tanks TO authenticated;
GRANT SELECT ON TABLE public.fuel_log_tank_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fuel_transfers TO authenticated;
