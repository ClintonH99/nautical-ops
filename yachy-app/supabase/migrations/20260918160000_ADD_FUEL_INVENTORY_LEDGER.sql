-- Accurate, append-only vessel fuel inventory.
--
-- The preceding fuel-foundation migration intentionally preserved the legacy
-- fuel_logs model.  This migration adds the operational inventory ledger.  An
-- inventory balance is never inferred from legacy receipts: an HOD/Captain
-- explicitly activates a vessel by recording an opening level for every active
-- tank.  After activation, all movements are written through atomic RPCs and
-- every affected tank is replayed in effective-time order.

ALTER TABLE public.vessel_fuel_settings
  ADD COLUMN IF NOT EXISTS inventory_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS setup_revision INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vessel_fuel_settings_setup_revision_check'
      AND conrelid = 'public.vessel_fuel_settings'::regclass
  ) THEN
    ALTER TABLE public.vessel_fuel_settings
      ADD CONSTRAINT vessel_fuel_settings_setup_revision_check
      CHECK (setup_revision >= 0);
  END IF;
END;
$$;

ALTER TABLE public.fuel_tanks
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE public.fuel_logs
  ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS utc_offset_minutes SMALLINT,
  ADD COLUMN IF NOT EXISTS current_inventory_operation_id UUID,
  ADD COLUMN IF NOT EXISTS inventory_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID,
  ADD COLUMN IF NOT EXISTS voided_by_name TEXT;

ALTER TABLE public.fuel_transfers
  ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS utc_offset_minutes SMALLINT,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS current_inventory_operation_id UUID,
  ADD COLUMN IF NOT EXISTS inventory_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID,
  ADD COLUMN IF NOT EXISTS voided_by_name TEXT;

-- A report-only source row still needs an unambiguous ship-time record. Older
-- installed clients do not send either field, so NULL/NULL remains a truthful
-- marker for legacy evidence; partial timestamp context is never accepted.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fuel_logs_effective_context_check'
      AND conrelid = 'public.fuel_logs'::regclass
  ) THEN
    ALTER TABLE public.fuel_logs
      ADD CONSTRAINT fuel_logs_effective_context_check CHECK (
        (effective_at IS NULL AND utc_offset_minutes IS NULL)
        OR (
          effective_at IS NOT NULL
          AND utc_offset_minutes IS NOT NULL
          AND utc_offset_minutes BETWEEN -840 AND 840
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fuel_transfers_effective_context_check'
      AND conrelid = 'public.fuel_transfers'::regclass
  ) THEN
    ALTER TABLE public.fuel_transfers
      ADD CONSTRAINT fuel_transfers_effective_context_check CHECK (
        (effective_at IS NULL AND utc_offset_minutes IS NULL)
        OR (
          effective_at IS NOT NULL
          AND utc_offset_minutes IS NOT NULL
          AND utc_offset_minutes BETWEEN -840 AND 840
        )
      );
  END IF;
END;
$$;

-- Legacy transfers previously stored only the creator UUID. Snapshot every
-- name that can still be reconstructed before account deletion can clear that
-- UUID, while leaving genuinely unknown historical actors explicit as NULL.
UPDATE public.fuel_transfers AS transfer
SET created_by_name = NULLIF(BTRIM(profile.name), '')
FROM public.users AS profile
WHERE transfer.created_by = profile.id
  AND transfer.created_by_name IS NULL
  AND NULLIF(BTRIM(profile.name), '') IS NOT NULL;

-- New transfer attribution is server-owned and immutable. The one permitted
-- update is the created_by -> NULL action performed by its ON DELETE SET NULL
-- foreign key; the name snapshot deliberately survives that cleanup.
CREATE OR REPLACE FUNCTION public.enforce_fuel_transfer_actor()
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
    RAISE EXCEPTION 'An authenticated user is required to create a fuel transfer';
  END IF;

  SELECT name INTO actor_name
  FROM public.users
  WHERE id = actor_id;

  IF actor_name IS NULL THEN
    RAISE EXCEPTION 'A valid user profile is required to create a fuel transfer';
  END IF;

  NEW.created_by := actor_id;
  NEW.created_by_name := actor_name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_fuel_transfer_actor ON public.fuel_transfers;
CREATE TRIGGER enforce_fuel_transfer_actor
  BEFORE INSERT OR UPDATE OF created_by, created_by_name
  ON public.fuel_transfers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fuel_transfer_actor();

CREATE SEQUENCE IF NOT EXISTS public.fuel_inventory_effective_order_seq;
CREATE SEQUENCE IF NOT EXISTS public.fuel_inventory_audit_sequence_seq;

CREATE TABLE IF NOT EXISTS public.fuel_inventory_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  logical_operation_id UUID NOT NULL,
  revision_no INTEGER NOT NULL,
  operation_type TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  effective_order BIGINT NOT NULL
    DEFAULT nextval('public.fuel_inventory_effective_order_seq'),
  recorded_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  audit_sequence BIGINT NOT NULL
    DEFAULT nextval('public.fuel_inventory_audit_sequence_seq'),
  utc_offset_minutes SMALLINT,
  source_fuel_log_id UUID REFERENCES public.fuel_logs(id) ON DELETE CASCADE,
  source_fuel_transfer_id UUID REFERENCES public.fuel_transfers(id) ON DELETE CASCADE,
  supersedes_operation_id UUID UNIQUE
    REFERENCES public.fuel_inventory_operations(id) ON DELETE CASCADE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  client_request_id UUID NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fuel_inventory_operations_revision_check CHECK (revision_no > 0),
  CONSTRAINT fuel_inventory_operations_type_check CHECK (
    operation_type IN (
      'OPENING', 'REFUEL', 'TRANSFER', 'SOUNDING', 'CONSUMPTION', 'ADJUSTMENT'
    )
  ),
  CONSTRAINT fuel_inventory_operations_offset_check CHECK (
    utc_offset_minutes IS NULL OR utc_offset_minutes BETWEEN -840 AND 840
  ),
  CONSTRAINT fuel_inventory_operations_metadata_check CHECK (
    jsonb_typeof(metadata) = 'object' AND octet_length(metadata::TEXT) <= 20000
  ),
  CONSTRAINT fuel_inventory_operations_source_shape_check CHECK (
    num_nonnulls(source_fuel_log_id, source_fuel_transfer_id) <= 1
    AND (operation_type <> 'REFUEL' OR source_fuel_log_id IS NOT NULL)
    AND (operation_type <> 'TRANSFER' OR source_fuel_transfer_id IS NOT NULL)
    AND (operation_type = 'REFUEL' OR source_fuel_log_id IS NULL)
    AND (operation_type = 'TRANSFER' OR source_fuel_transfer_id IS NULL)
  ),
  CONSTRAINT fuel_inventory_operations_request_key UNIQUE (vessel_id, client_request_id),
  CONSTRAINT fuel_inventory_operations_revision_key UNIQUE (logical_operation_id, revision_no)
);

CREATE TABLE IF NOT EXISTS public.fuel_inventory_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL
    REFERENCES public.fuel_inventory_operations(id) ON DELETE CASCADE,
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  fuel_tank_id UUID NOT NULL REFERENCES public.fuel_tanks(id) ON DELETE RESTRICT,
  posting_mode TEXT NOT NULL,
  -- ABSOLUTE stores the measured level. DELTA stores a signed movement.
  amount_litres NUMERIC(14, 3) NOT NULL,
  tank_name_snapshot TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fuel_inventory_postings_mode_check
    CHECK (posting_mode IN ('ABSOLUTE', 'DELTA')),
  CONSTRAINT fuel_inventory_postings_amount_check CHECK (
    (posting_mode = 'ABSOLUTE' AND amount_litres >= 0)
    OR (posting_mode = 'DELTA' AND amount_litres <> 0)
  ),
  CONSTRAINT fuel_inventory_postings_tank_name_check
    CHECK (char_length(btrim(tank_name_snapshot)) BETWEEN 1 AND 120),
  CONSTRAINT fuel_inventory_postings_operation_tank_key
    UNIQUE (operation_id, fuel_tank_id)
);

CREATE TABLE IF NOT EXISTS public.fuel_inventory_voids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL UNIQUE
    REFERENCES public.fuel_inventory_operations(id) ON DELETE CASCADE,
  void_kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  client_request_id UUID NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  audit_sequence BIGINT NOT NULL
    DEFAULT nextval('public.fuel_inventory_audit_sequence_seq'),
  CONSTRAINT fuel_inventory_voids_kind_check
    CHECK (void_kind IN ('AMENDMENT', 'ERROR')),
  CONSTRAINT fuel_inventory_voids_reason_check
    CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  CONSTRAINT fuel_inventory_voids_request_key UNIQUE (vessel_id, client_request_id)
);

-- Non-ledger mutations that still need offline-safe idempotency store their
-- exact committed response here.  This shares the same vessel/request UUID
-- namespace as operations and voids through the request-lock helpers below.
CREATE TABLE IF NOT EXISTS public.fuel_inventory_request_results (
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  client_request_id UUID NOT NULL,
  request_kind TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_payload JSONB NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vessel_id, client_request_id),
  CONSTRAINT fuel_inventory_request_results_kind_check CHECK (
    request_kind IN (
      'LEGACY_REFUEL_CREATE', 'LEGACY_REFUEL_AMEND', 'LEGACY_REFUEL_VOID',
      'LEGACY_TRANSFER_CREATE', 'LEGACY_TRANSFER_AMEND',
      'LEGACY_TRANSFER_VOID', 'FUEL_SETUP_SAVE'
    )
  ),
  CONSTRAINT fuel_inventory_request_results_payload_check CHECK (
    jsonb_typeof(result_payload) = 'object'
  )
);

ALTER TABLE public.fuel_inventory_request_results
  DROP CONSTRAINT IF EXISTS fuel_inventory_request_results_kind_check;
ALTER TABLE public.fuel_inventory_request_results
  ADD CONSTRAINT fuel_inventory_request_results_kind_check CHECK (
    request_kind IN (
      'LEGACY_REFUEL_CREATE', 'LEGACY_REFUEL_AMEND', 'LEGACY_REFUEL_VOID',
      'LEGACY_TRANSFER_CREATE', 'LEGACY_TRANSFER_AMEND',
      'LEGACY_TRANSFER_VOID', 'FUEL_SETUP_SAVE'
    )
  );

CREATE TABLE IF NOT EXISTS public.fuel_inventory_legacy_source_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('FUEL_LOG', 'FUEL_TRANSFER')),
  source_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('AMENDMENT', 'VOID')),
  before_snapshot JSONB NOT NULL CHECK (jsonb_typeof(before_snapshot) = 'object'),
  after_snapshot JSONB NOT NULL CHECK (jsonb_typeof(after_snapshot) = 'object'),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  client_request_id UUID NOT NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vessel_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS fuel_inventory_legacy_source_audits_source_idx
  ON public.fuel_inventory_legacy_source_audits (
    vessel_id, source_type, source_id, recorded_at, id
  );

-- ADD COLUMN keeps migration reapplication safe for development databases that
-- were created from an earlier draft of this not-yet-deployed migration.
ALTER TABLE public.fuel_inventory_operations
  ADD COLUMN IF NOT EXISTS audit_sequence BIGINT NOT NULL
    DEFAULT nextval('public.fuel_inventory_audit_sequence_seq');
ALTER TABLE public.fuel_inventory_voids
  ADD COLUMN IF NOT EXISTS audit_sequence BIGINT NOT NULL
    DEFAULT nextval('public.fuel_inventory_audit_sequence_seq');

CREATE INDEX IF NOT EXISTS fuel_inventory_operations_vessel_effective_idx
  ON public.fuel_inventory_operations (
    vessel_id, effective_at, effective_order, recorded_sequence
  );
CREATE INDEX IF NOT EXISTS fuel_inventory_operations_logical_idx
  ON public.fuel_inventory_operations (logical_operation_id, revision_no DESC);
CREATE INDEX IF NOT EXISTS fuel_inventory_postings_tank_operation_idx
  ON public.fuel_inventory_postings (fuel_tank_id, operation_id);
CREATE INDEX IF NOT EXISTS fuel_inventory_postings_vessel_idx
  ON public.fuel_inventory_postings (vessel_id, operation_id);
CREATE UNIQUE INDEX IF NOT EXISTS fuel_inventory_operations_audit_sequence_key
  ON public.fuel_inventory_operations (audit_sequence);
CREATE UNIQUE INDEX IF NOT EXISTS fuel_inventory_voids_audit_sequence_key
  ON public.fuel_inventory_voids (audit_sequence);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fuel_logs_current_inventory_operation_fkey'
      AND conrelid = 'public.fuel_logs'::regclass
  ) THEN
    ALTER TABLE public.fuel_logs
      ADD CONSTRAINT fuel_logs_current_inventory_operation_fkey
      FOREIGN KEY (current_inventory_operation_id)
      REFERENCES public.fuel_inventory_operations(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fuel_transfers_current_inventory_operation_fkey'
      AND conrelid = 'public.fuel_transfers'::regclass
  ) THEN
    ALTER TABLE public.fuel_transfers
      ADD CONSTRAINT fuel_transfers_current_inventory_operation_fkey
      FOREIGN KEY (current_inventory_operation_id)
      REFERENCES public.fuel_inventory_operations(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fuel_logs_voided_by_fkey'
      AND conrelid = 'public.fuel_logs'::regclass
  ) THEN
    ALTER TABLE public.fuel_logs
      ADD CONSTRAINT fuel_logs_voided_by_fkey
      FOREIGN KEY (voided_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fuel_transfers_voided_by_fkey'
      AND conrelid = 'public.fuel_transfers'::regclass
  ) THEN
    ALTER TABLE public.fuel_transfers
      ADD CONSTRAINT fuel_transfers_voided_by_fkey
      FOREIGN KEY (voided_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._fuel_inventory_request_fingerprint(p_payload JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  -- JSONB has a canonical textual representation. Storing that exact value is
  -- collision-free for idempotency comparisons and avoids an optional hashing
  -- extension in bare PostgreSQL migration replays.
  SELECT p_payload::TEXT;
$$;

CREATE OR REPLACE FUNCTION public._fuel_inventory_actor_name()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required for fuel inventory changes';
  END IF;
  SELECT name INTO actor_name FROM public.users WHERE id = auth.uid();
  IF actor_name IS NULL THEN
    RAISE EXCEPTION 'A valid user profile is required for fuel inventory changes';
  END IF;
  RETURN actor_name;
END;
$$;

CREATE OR REPLACE FUNCTION public._validate_fuel_inventory_effective_time(
  p_effective_at TIMESTAMPTZ,
  p_utc_offset_minutes SMALLINT,
  p_local_date DATE DEFAULT NULL,
  p_local_time TIME DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  effective_local TIMESTAMP;
  supplied_local TIMESTAMP;
BEGIN
  IF p_effective_at IS NULL THEN
    RAISE EXCEPTION 'An effective time is required';
  END IF;
  IF p_utc_offset_minutes IS NULL OR p_utc_offset_minutes NOT BETWEEN -840 AND 840 THEN
    RAISE EXCEPTION 'A valid UTC offset is required';
  END IF;
  IF p_effective_at > clock_timestamp() + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'Fuel inventory effective time cannot be in the future';
  END IF;
  IF (p_local_date IS NULL) <> (p_local_time IS NULL) THEN
    RAISE EXCEPTION 'Local date and local time must be supplied together';
  END IF;
  IF p_local_date IS NOT NULL THEN
    effective_local := (p_effective_at AT TIME ZONE 'UTC')
      + make_interval(mins => p_utc_offset_minutes);
    supplied_local := p_local_date + p_local_time;
    IF abs(EXTRACT(EPOCH FROM (effective_local - supplied_local))) > 1 THEN
      RAISE EXCEPTION 'Local fuel date/time does not match effective time and UTC offset';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._lock_fuel_inventory_tanks(p_tank_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  expected_count INTEGER;
  actual_count INTEGER;
BEGIN
  SELECT count(*) INTO expected_count
  FROM (SELECT DISTINCT id FROM unnest(COALESCE(p_tank_ids, ARRAY[]::UUID[])) AS id) AS ids;

  SELECT count(*) INTO actual_count
  FROM (
    SELECT tank.id
    FROM public.fuel_tanks AS tank
    WHERE tank.id = ANY(COALESCE(p_tank_ids, ARRAY[]::UUID[]))
    ORDER BY tank.id
    FOR UPDATE
  ) AS locked;

  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'One or more fuel tanks were not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._lock_fuel_inventory_vessel(p_vessel_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_vessel_id IS NULL THEN
    RAISE EXCEPTION 'A vessel is required';
  END IF;
  -- Tank setup, activation, and ledger writes share this transaction lock so
  -- a tank cannot be added/archived between a caller's completeness check and
  -- its postings.  Fine-grained tank locks still protect deterministic replay.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'fuel-inventory-vessel:' || p_vessel_id::TEXT,
    0
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public._lock_fuel_inventory_request(
  p_vessel_id UUID,
  p_client_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_vessel_id IS NULL OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'A vessel and client request ID are required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_vessel_id::TEXT || ':' || p_client_request_id::TEXT,
    0
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public._fuel_inventory_existing_request_result(
  p_vessel_id UUID,
  p_client_request_id UUID,
  p_request_kind TEXT,
  p_request_fingerprint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing public.fuel_inventory_request_results%ROWTYPE;
BEGIN
  PERFORM public._lock_fuel_inventory_request(p_vessel_id, p_client_request_id);
  SELECT * INTO existing
  FROM public.fuel_inventory_request_results AS request_result
  WHERE request_result.vessel_id = p_vessel_id
    AND request_result.client_request_id = p_client_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF existing.request_kind <> p_request_kind
    OR existing.request_fingerprint <> p_request_fingerprint THEN
    RAISE EXCEPTION 'Client request ID was already used with a different payload';
  END IF;
  RETURN existing.result_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public._fuel_inventory_existing_request(
  p_vessel_id UUID,
  p_client_request_id UUID,
  p_request_fingerprint TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing_id UUID;
  existing_fingerprint TEXT;
  conflicting_fingerprint TEXT;
BEGIN
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'A client request ID is required';
  END IF;

  -- Serialize every request key before looking it up.  Without this lock, two
  -- concurrent deliveries of the same offline request can both observe no
  -- row and one will fail the unique constraint instead of replaying the
  -- committed result.  The lock is transaction-scoped and collision-safe:
  -- an advisory-hash collision only causes harmless extra serialization.
  PERFORM public._lock_fuel_inventory_request(p_vessel_id, p_client_request_id);

  IF EXISTS (
    SELECT 1
    FROM public.fuel_inventory_request_results AS request_result
    WHERE request_result.vessel_id = p_vessel_id
      AND request_result.client_request_id = p_client_request_id
  ) THEN
    RAISE EXCEPTION 'Client request ID was already used by another fuel action';
  END IF;

  WITH matching_requests AS (
    SELECT 0 AS source_priority, operation.id AS result_operation_id,
      operation.request_fingerprint
    FROM public.fuel_inventory_operations AS operation
    WHERE operation.vessel_id = p_vessel_id
      AND operation.client_request_id = p_client_request_id
    UNION ALL
    SELECT 1, voided.operation_id, voided.request_fingerprint
    FROM public.fuel_inventory_voids AS voided
    WHERE voided.vessel_id = p_vessel_id
      AND voided.client_request_id = p_client_request_id
  )
  SELECT
    (array_agg(result_operation_id ORDER BY source_priority))[1],
    min(request_fingerprint),
    max(request_fingerprint)
  INTO existing_id, existing_fingerprint, conflicting_fingerprint
  FROM matching_requests;

  IF existing_id IS NOT NULL AND (
    existing_fingerprint <> p_request_fingerprint
    OR conflicting_fingerprint <> p_request_fingerprint
  ) THEN
    RAISE EXCEPTION 'Client request ID was already used with a different payload';
  END IF;
  RETURN existing_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._validate_fuel_inventory_operation(p_operation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  operation_row public.fuel_inventory_operations%ROWTYPE;
  posting_count INTEGER;
  absolute_count INTEGER;
  delta_count INTEGER;
  positive_count INTEGER;
  negative_count INTEGER;
  posting_total NUMERIC;
BEGIN
  SELECT * INTO operation_row
  FROM public.fuel_inventory_operations
  WHERE id = p_operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fuel inventory operation was not found'; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.fuel_inventory_postings AS posting
    LEFT JOIN public.fuel_tanks AS tank ON tank.id = posting.fuel_tank_id
    WHERE posting.operation_id = p_operation_id
      AND (
        posting.vessel_id <> operation_row.vessel_id
        OR tank.id IS NULL
        OR tank.vessel_id <> operation_row.vessel_id
      )
  ) THEN
    RAISE EXCEPTION 'Fuel inventory postings must use tanks from the operation vessel';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE posting_mode = 'ABSOLUTE'),
    count(*) FILTER (WHERE posting_mode = 'DELTA'),
    count(*) FILTER (WHERE amount_litres > 0),
    count(*) FILTER (WHERE amount_litres < 0),
    COALESCE(sum(amount_litres), 0)
  INTO posting_count, absolute_count, delta_count, positive_count, negative_count, posting_total
  FROM public.fuel_inventory_postings
  WHERE operation_id = p_operation_id;

  CASE operation_row.operation_type
    WHEN 'OPENING' THEN
      IF posting_count < 1 OR absolute_count <> posting_count THEN
        RAISE EXCEPTION 'Opening operations require absolute levels';
      END IF;
    WHEN 'SOUNDING' THEN
      IF posting_count < 1 OR absolute_count <> posting_count THEN
        RAISE EXCEPTION 'Sounding operations require absolute levels';
      END IF;
    WHEN 'REFUEL' THEN
      IF posting_count < 1 OR delta_count <> posting_count OR positive_count <> posting_count THEN
        RAISE EXCEPTION 'Refuel operations require positive delta postings';
      END IF;
    WHEN 'TRANSFER' THEN
      IF posting_count <> 2 OR delta_count <> 2 OR positive_count <> 1
        OR negative_count <> 1 OR posting_total <> 0 THEN
        RAISE EXCEPTION 'Transfer operations require two equal and opposite delta postings';
      END IF;
    WHEN 'CONSUMPTION' THEN
      IF posting_count <> 1 OR delta_count <> 1 OR negative_count <> 1 THEN
        RAISE EXCEPTION 'Consumption operations require one negative delta posting';
      END IF;
    WHEN 'ADJUSTMENT' THEN
      IF posting_count <> 1 OR delta_count <> 1 THEN
        RAISE EXCEPTION 'Adjustment operations require one signed delta posting';
      END IF;
    ELSE
      RAISE EXCEPTION 'Unknown fuel inventory operation type';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public._validate_fuel_inventory_timelines(p_tank_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tank_row RECORD;
  posting_row RECORD;
  running_balance NUMERIC;
  saw_event BOOLEAN;
  opening_count INTEGER;
BEGIN
  FOR tank_row IN
    SELECT id, capacity_litres, created_at, archived_at
    FROM public.fuel_tanks
    WHERE id = ANY(COALESCE(p_tank_ids, ARRAY[]::UUID[]))
    ORDER BY id
  LOOP
    running_balance := NULL;
    saw_event := FALSE;
    opening_count := 0;

    FOR posting_row IN
      SELECT
        operation.operation_type,
        operation.effective_at,
        operation.effective_order,
        posting.posting_mode,
        posting.amount_litres
      FROM public.fuel_inventory_postings AS posting
      JOIN public.fuel_inventory_operations AS operation
        ON operation.id = posting.operation_id
      WHERE posting.fuel_tank_id = tank_row.id
        AND NOT EXISTS (
          SELECT 1 FROM public.fuel_inventory_voids AS voided
          WHERE voided.operation_id = operation.id
        )
      ORDER BY operation.effective_at, operation.effective_order, operation.recorded_sequence
    LOOP
      IF NOT saw_event AND posting_row.operation_type <> 'OPENING' THEN
        RAISE EXCEPTION 'Fuel tank inventory must begin with an opening level';
      END IF;

      -- Mobile date/time inputs are minute-granular.  Treat the catalogue
      -- creation minute as the lifecycle boundary so a tank saved at 15:22:47
      -- can be opened immediately at the UI value 15:22:00.
      IF posting_row.effective_at < date_trunc('minute', tank_row.created_at)
        OR (tank_row.archived_at IS NOT NULL
          AND posting_row.effective_at >= tank_row.archived_at) THEN
        RAISE EXCEPTION 'Fuel inventory activity must fall within the tank lifecycle';
      END IF;

      IF posting_row.operation_type = 'OPENING' THEN
        opening_count := opening_count + 1;
        IF saw_event OR posting_row.posting_mode <> 'ABSOLUTE' THEN
          RAISE EXCEPTION 'A fuel tank opening level must be its first active event';
        END IF;
      END IF;

      IF posting_row.posting_mode = 'ABSOLUTE' THEN
        IF posting_row.operation_type NOT IN ('OPENING', 'SOUNDING') THEN
          RAISE EXCEPTION 'Only opening and sounding operations may set an absolute level';
        END IF;
        running_balance := posting_row.amount_litres;
      ELSE
        IF running_balance IS NULL THEN
          RAISE EXCEPTION 'Fuel tank inventory is not initialized';
        END IF;
        running_balance := running_balance + posting_row.amount_litres;
      END IF;

      IF running_balance < 0 THEN
        RAISE EXCEPTION 'Fuel inventory change would make a tank balance negative';
      END IF;
      IF running_balance > tank_row.capacity_litres THEN
        RAISE EXCEPTION 'Fuel inventory change would exceed tank capacity';
      END IF;
      saw_event := TRUE;
    END LOOP;

    IF saw_event AND opening_count <> 1 THEN
      RAISE EXCEPTION 'Each initialized fuel tank requires exactly one active opening level';
    END IF;
    IF tank_row.archived_at IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.fuel_inventory_postings AS posting
        JOIN public.fuel_inventory_operations AS operation
          ON operation.id = posting.operation_id
        WHERE posting.fuel_tank_id = tank_row.id
          AND operation.effective_at > clock_timestamp()
          AND NOT EXISTS (
            SELECT 1 FROM public.fuel_inventory_voids AS voided
            WHERE voided.operation_id = operation.id
          )
      ) THEN
        RAISE EXCEPTION 'An archived fuel tank cannot have future inventory activity';
      END IF;
      IF COALESCE(public._fuel_inventory_tank_balance_at(
        tank_row.id, clock_timestamp()
      ), 0) <> 0 THEN
        RAISE EXCEPTION 'An archived fuel tank must keep a zero current balance';
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._fuel_inventory_operation_json(p_operation_id UUID)
RETURNS JSONB
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', operation.id,
    'vessel_id', operation.vessel_id,
    'logical_operation_id', operation.logical_operation_id,
    'revision_no', operation.revision_no,
    'operation_type', operation.operation_type,
    'effective_at', operation.effective_at,
    'effective_order', operation.effective_order,
    'recorded_sequence', operation.recorded_sequence,
    'audit_sequence', GREATEST(
      operation.audit_sequence,
      COALESCE((SELECT voided.audit_sequence
        FROM public.fuel_inventory_voids AS voided
        WHERE voided.operation_id = operation.id), operation.audit_sequence)
    ),
    'utc_offset_minutes', operation.utc_offset_minutes,
    'source_fuel_log_id', operation.source_fuel_log_id,
    'source_fuel_transfer_id', operation.source_fuel_transfer_id,
    'supersedes_operation_id', operation.supersedes_operation_id,
    'metadata', operation.metadata,
    'created_by', operation.created_by,
    'created_by_name', operation.created_by_name,
    'recorded_at', operation.recorded_at,
    'voided', EXISTS (
      SELECT 1 FROM public.fuel_inventory_voids AS voided
      WHERE voided.operation_id = operation.id
    ),
    'void_kind', (
      SELECT voided.void_kind FROM public.fuel_inventory_voids AS voided
      WHERE voided.operation_id = operation.id
    ),
    'void_reason', (
      SELECT voided.reason FROM public.fuel_inventory_voids AS voided
      WHERE voided.operation_id = operation.id
    ),
    'void_created_by', (
      SELECT voided.created_by FROM public.fuel_inventory_voids AS voided
      WHERE voided.operation_id = operation.id
    ),
    'void_created_by_name', (
      SELECT voided.created_by_name FROM public.fuel_inventory_voids AS voided
      WHERE voided.operation_id = operation.id
    ),
    'void_recorded_at', (
      SELECT voided.recorded_at FROM public.fuel_inventory_voids AS voided
      WHERE voided.operation_id = operation.id
    ),
    'postings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fuel_tank_id', posting.fuel_tank_id,
        'tank_name', posting.tank_name_snapshot,
        'posting_mode', posting.posting_mode,
        'amount_litres', posting.amount_litres
      ) ORDER BY posting.tank_name_snapshot, posting.fuel_tank_id)
      FROM public.fuel_inventory_postings AS posting
      WHERE posting.operation_id = operation.id
    ), '[]'::JSONB)
  )
  FROM public.fuel_inventory_operations AS operation
  WHERE operation.id = p_operation_id;
$$;

CREATE OR REPLACE FUNCTION public._fuel_inventory_legacy_fuel_log_snapshot(
  p_fuel_log_id UUID
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT to_jsonb(fuel_log) || jsonb_build_object(
    'allocations', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(entry) || jsonb_build_object('tank_name', tank.name)
        ORDER BY entry.fuel_tank_id, entry.id
      )
      FROM public.fuel_log_tank_entries AS entry
      LEFT JOIN public.fuel_tanks AS tank ON tank.id = entry.fuel_tank_id
      WHERE entry.fuel_log_id = fuel_log.id
    ), '[]'::JSONB)
  )
  FROM public.fuel_logs AS fuel_log
  WHERE fuel_log.id = p_fuel_log_id;
$$;

CREATE OR REPLACE FUNCTION public._fuel_inventory_legacy_transfer_snapshot(
  p_fuel_transfer_id UUID
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT to_jsonb(transfer) || jsonb_build_object(
    'source_tank_name', source_tank.name,
    'destination_tank_name', destination_tank.name
  )
  FROM public.fuel_transfers AS transfer
  LEFT JOIN public.fuel_tanks AS source_tank
    ON source_tank.id = transfer.source_tank_id
  LEFT JOIN public.fuel_tanks AS destination_tank
    ON destination_tank.id = transfer.destination_tank_id
  WHERE transfer.id = p_fuel_transfer_id;
$$;

REVOKE ALL ON FUNCTION public._fuel_inventory_request_fingerprint(JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fuel_inventory_actor_name()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._validate_fuel_inventory_effective_time(
  TIMESTAMPTZ, SMALLINT, DATE, TIME
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lock_fuel_inventory_tanks(UUID[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lock_fuel_inventory_vessel(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lock_fuel_inventory_request(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fuel_inventory_existing_request_result(
  UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fuel_inventory_existing_request(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._validate_fuel_inventory_operation(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._validate_fuel_inventory_timelines(UUID[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fuel_inventory_operation_json(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fuel_inventory_legacy_fuel_log_snapshot(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fuel_inventory_legacy_transfer_snapshot(UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_fuel_inventory_operation(
  p_operation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  operation_vessel_id UUID;
  result_row JSONB;
BEGIN
  SELECT operation.vessel_id INTO operation_vessel_id
  FROM public.fuel_inventory_operations AS operation
  WHERE operation.id = p_operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fuel inventory operation was not found';
  END IF;
  IF NOT public.current_user_can_access_vessel(operation_vessel_id) THEN
    RAISE EXCEPTION 'Only active vessel members can view this fuel inventory operation';
  END IF;

  result_row := public._fuel_inventory_operation_json(p_operation_id);
  RETURN result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.get_fuel_inventory_operation(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_fuel_inventory_operation(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_fuel_inventory_snapshot(
  p_vessel_id UUID,
  p_as_of TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  settings_row public.vessel_fuel_settings%ROWTYPE;
  tank_rows JSONB;
  active_tank_count INTEGER;
  initialized_tank_count INTEGER;
  total_capacity NUMERIC;
  total_balance NUMERIC;
BEGIN
  IF p_vessel_id IS NULL OR NOT public.current_user_can_access_vessel(p_vessel_id) THEN
    RAISE EXCEPTION 'Only active vessel members can view fuel inventory';
  END IF;
  IF p_as_of IS NULL THEN RAISE EXCEPTION 'An as-of time is required'; END IF;

  SELECT * INTO settings_row
  FROM public.vessel_fuel_settings
  WHERE vessel_id = p_vessel_id;

  WITH active_postings AS (
    SELECT
      posting.fuel_tank_id,
      operation.operation_type,
      operation.effective_at,
      operation.utc_offset_minutes,
      operation.effective_order,
      operation.recorded_sequence,
      posting.posting_mode,
      posting.amount_litres,
      count(*) FILTER (WHERE posting.posting_mode = 'ABSOLUTE') OVER (
        PARTITION BY posting.fuel_tank_id
        ORDER BY operation.effective_at, operation.effective_order, operation.recorded_sequence
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS segment_no
    FROM public.fuel_inventory_postings AS posting
    JOIN public.fuel_inventory_operations AS operation
      ON operation.id = posting.operation_id
    WHERE operation.vessel_id = p_vessel_id
      AND operation.effective_at <= p_as_of
      AND NOT EXISTS (
        SELECT 1 FROM public.fuel_inventory_voids AS voided
        WHERE voided.operation_id = operation.id
      )
  ), balances AS (
    SELECT
      fuel_tank_id,
      operation_type,
      effective_at,
      effective_order,
      recorded_sequence,
      segment_no,
      max(amount_litres) FILTER (WHERE posting_mode = 'ABSOLUTE') OVER (
        PARTITION BY fuel_tank_id, segment_no
      )
      + COALESCE(sum(amount_litres) FILTER (WHERE posting_mode = 'DELTA') OVER (
        PARTITION BY fuel_tank_id, segment_no
        ORDER BY effective_at, effective_order, recorded_sequence
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ), 0) AS balance_litres
    FROM active_postings
  ), latest_balance AS (
    SELECT DISTINCT ON (fuel_tank_id)
      fuel_tank_id, balance_litres, effective_at AS last_activity_at
    FROM balances
    WHERE segment_no > 0
    ORDER BY fuel_tank_id, effective_at DESC, effective_order DESC, recorded_sequence DESC
  ), latest_verification AS (
    SELECT DISTINCT ON (fuel_tank_id)
      fuel_tank_id, effective_at AS last_verified_at,
      operation_type AS last_verified_type,
      utc_offset_minutes AS last_verified_utc_offset_minutes
    FROM active_postings
    WHERE posting_mode = 'ABSOLUTE'
    ORDER BY fuel_tank_id, effective_at DESC, effective_order DESC, recorded_sequence DESC
  ), tank_snapshot AS (
    SELECT
      tank.id,
      tank.vessel_id,
      tank.name,
      tank.location,
      tank.description,
      tank.capacity_litres,
      tank.archived_at,
      tank.created_by,
      tank.created_at,
      tank.updated_at,
      latest_balance.balance_litres,
      latest_balance.last_activity_at,
      latest_verification.last_verified_at,
      latest_verification.last_verified_type,
      latest_verification.last_verified_utc_offset_minutes
    FROM public.fuel_tanks AS tank
    LEFT JOIN latest_balance ON latest_balance.fuel_tank_id = tank.id
    LEFT JOIN latest_verification ON latest_verification.fuel_tank_id = tank.id
    WHERE tank.vessel_id = p_vessel_id
      -- Tank membership is evaluated at the requested instant.  Capacity,
      -- name, location, and description are current metadata (they are not a
      -- versioned catalogue), while balances and active/archived membership
      -- are historical.
      AND date_trunc('minute', tank.created_at) <= p_as_of
      AND (tank.archived_at IS NULL OR tank.archived_at > p_as_of)
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'vessel_id', vessel_id,
      'name', name,
      'location', location,
      'description', description,
      'capacity_litres', capacity_litres,
      'archived_at', archived_at,
      'created_by', created_by,
      'created_at', created_at,
      'updated_at', updated_at,
      'initialized', balance_litres IS NOT NULL,
      'balance_litres', balance_litres,
      'remaining_capacity_litres', CASE
        WHEN balance_litres IS NULL THEN NULL
        ELSE capacity_litres - balance_litres
      END,
      'last_verified_at', last_verified_at,
      'last_verified_type', last_verified_type,
      'last_verified_utc_offset_minutes', last_verified_utc_offset_minutes,
      'last_activity_at', last_activity_at
    ) ORDER BY lower(name), id), '[]'::JSONB),
    count(*),
    count(*) FILTER (WHERE balance_litres IS NOT NULL),
    COALESCE(sum(capacity_litres), 0),
    CASE
      WHEN count(*) = 0 OR count(*) FILTER (WHERE balance_litres IS NOT NULL) <> count(*)
        THEN NULL
      ELSE sum(balance_litres)
    END
  INTO tank_rows, active_tank_count, initialized_tank_count, total_capacity, total_balance
  FROM tank_snapshot;

  RETURN jsonb_build_object(
    'vessel_id', p_vessel_id,
    'as_of', p_as_of,
    'settings', jsonb_build_object(
      'volume_unit', COALESCE(settings_row.volume_unit, 'LITRES'),
      'inventory_activated_at', CASE
        WHEN settings_row.inventory_activated_at <= p_as_of
          THEN settings_row.inventory_activated_at
        ELSE NULL
      END
    ),
    'status', jsonb_build_object(
      'activated', COALESCE(settings_row.inventory_activated_at <= p_as_of, FALSE),
      'fully_initialized', COALESCE(settings_row.inventory_activated_at <= p_as_of, FALSE)
        AND active_tank_count > 0
        AND initialized_tank_count = active_tank_count
    ),
    'tanks', tank_rows,
    'total_capacity_litres', total_capacity,
    'total_balance_litres', total_balance
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_fuel_inventory_history(
  p_vessel_id UUID,
  p_tank_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_before_recorded_sequence BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  result_rows JSONB;
  next_cursor BIGINT;
BEGIN
  IF p_vessel_id IS NULL OR NOT public.current_user_can_access_vessel(p_vessel_id) THEN
    RAISE EXCEPTION 'Only active vessel members can view fuel inventory history';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 250 THEN
    RAISE EXCEPTION 'Fuel inventory history limit must be between 1 and 250';
  END IF;
  IF p_tank_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fuel_tanks
    WHERE id = p_tank_id AND vessel_id = p_vessel_id
  ) THEN
    RAISE EXCEPTION 'Fuel tank does not belong to the active vessel';
  END IF;

  WITH selected AS (
    SELECT operation.*,
      GREATEST(operation.audit_sequence, COALESCE(voided.audit_sequence, 0))
        AS activity_sequence
    FROM public.fuel_inventory_operations AS operation
    LEFT JOIN public.fuel_inventory_voids AS voided
      ON voided.operation_id = operation.id
    WHERE operation.vessel_id = p_vessel_id
      AND (p_before_recorded_sequence IS NULL
        OR GREATEST(operation.audit_sequence, COALESCE(voided.audit_sequence, 0))
          < p_before_recorded_sequence)
      AND (p_tank_id IS NULL OR EXISTS (
        SELECT 1 FROM public.fuel_inventory_postings AS posting
        WHERE posting.operation_id = operation.id
          AND posting.fuel_tank_id = p_tank_id
      ))
    ORDER BY activity_sequence DESC
    LIMIT p_limit
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', operation.id,
      'vessel_id', operation.vessel_id,
      'logical_operation_id', operation.logical_operation_id,
      'revision_no', operation.revision_no,
      'operation_type', operation.operation_type,
      'effective_at', operation.effective_at,
      'effective_order', operation.effective_order,
      'recorded_sequence', operation.recorded_sequence,
      'audit_sequence', operation.activity_sequence,
      'utc_offset_minutes', operation.utc_offset_minutes,
      'source_fuel_log_id', operation.source_fuel_log_id,
      'source_fuel_transfer_id', operation.source_fuel_transfer_id,
      'supersedes_operation_id', operation.supersedes_operation_id,
      'metadata', operation.metadata,
      'created_by', operation.created_by,
      'created_by_name', operation.created_by_name,
      'recorded_at', operation.recorded_at,
      'voided', voided.id IS NOT NULL,
      'void_kind', voided.void_kind,
      'void_reason', voided.reason,
      'void_created_by', voided.created_by,
      'void_created_by_name', voided.created_by_name,
      'void_recorded_at', voided.recorded_at,
      'postings', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'fuel_tank_id', posting.fuel_tank_id,
          'tank_name', posting.tank_name_snapshot,
          'posting_mode', posting.posting_mode,
          'amount_litres', posting.amount_litres
        ) ORDER BY posting.tank_name_snapshot, posting.fuel_tank_id)
        FROM public.fuel_inventory_postings AS posting
        WHERE posting.operation_id = operation.id
      ), '[]'::JSONB)
    ) ORDER BY operation.activity_sequence DESC), '[]'::JSONB),
    min(operation.activity_sequence)
  INTO result_rows, next_cursor
  FROM selected AS operation
  LEFT JOIN public.fuel_inventory_voids AS voided
    ON voided.operation_id = operation.id;

  RETURN jsonb_build_object(
    'operations', result_rows,
    'next_before_sequence', CASE
      WHEN jsonb_array_length(result_rows) = p_limit THEN next_cursor
      ELSE NULL
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_fuel_inventory_snapshot(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_fuel_inventory_history(UUID, UUID, INTEGER, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_fuel_inventory_snapshot(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fuel_inventory_history(UUID, UUID, INTEGER, BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_vessel_fuel_inventory(
  p_vessel_id UUID,
  p_effective_at TIMESTAMPTZ,
  p_utc_offset_minutes SMALLINT,
  p_openings JSONB,
  p_notes TEXT,
  p_client_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_name TEXT;
  request_payload JSONB;
  request_fingerprint TEXT;
  existing_operation_id UUID;
  operation_id UUID := gen_random_uuid();
  active_tank_ids UUID[];
  target_tank_ids UUID[];
  already_activated BOOLEAN;
BEGIN
  IF p_vessel_id IS NULL OR NOT public.current_user_can_manage_vessel(p_vessel_id) THEN
    RAISE EXCEPTION 'Only an HOD or Captain/MOV can activate vessel fuel inventory';
  END IF;
  PERFORM public._validate_fuel_inventory_effective_time(
    p_effective_at, p_utc_offset_minutes
  );
  IF p_openings IS NULL OR jsonb_typeof(p_openings) <> 'array'
    OR jsonb_array_length(p_openings) = 0 THEN
    RAISE EXCEPTION 'Opening levels are required for every active tank';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_openings) AS opening(fuel_tank_id UUID, amount_litres NUMERIC)
    WHERE fuel_tank_id IS NULL OR amount_litres IS NULL OR amount_litres < 0
  ) THEN
    RAISE EXCEPTION 'Every opening requires a tank and non-negative level';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT fuel_tank_id
      FROM jsonb_to_recordset(p_openings) AS opening(fuel_tank_id UUID, amount_litres NUMERIC)
      GROUP BY fuel_tank_id HAVING count(*) > 1
    ) AS duplicate_openings
  ) THEN
    RAISE EXCEPTION 'A tank may only appear once in opening levels';
  END IF;

  request_payload := jsonb_build_object(
    'rpc', 'activate_vessel_fuel_inventory',
    'vessel_id', p_vessel_id,
    'effective_at', p_effective_at,
    'utc_offset_minutes', p_utc_offset_minutes,
    'openings', p_openings,
    'notes', COALESCE(btrim(p_notes), '')
  );
  request_fingerprint := public._fuel_inventory_request_fingerprint(request_payload);
  existing_operation_id := public._fuel_inventory_existing_request(
    p_vessel_id, p_client_request_id, request_fingerprint
  );
  IF existing_operation_id IS NOT NULL THEN
    RETURN public.get_fuel_inventory_snapshot(p_vessel_id, now());
  END IF;

  PERFORM public._lock_fuel_inventory_vessel(p_vessel_id);
  SELECT array_agg(id ORDER BY id) INTO active_tank_ids
  FROM public.fuel_tanks
  WHERE vessel_id = p_vessel_id AND archived_at IS NULL;
  IF active_tank_ids IS NULL THEN RAISE EXCEPTION 'Configure at least one fuel tank first'; END IF;

  SELECT inventory_activated_at IS NOT NULL INTO already_activated
  FROM public.vessel_fuel_settings WHERE vessel_id = p_vessel_id;
  already_activated := COALESCE(already_activated, FALSE);
  IF already_activated THEN
    SELECT array_agg(tank.id ORDER BY tank.id) INTO target_tank_ids
    FROM public.fuel_tanks AS tank
    WHERE tank.vessel_id = p_vessel_id AND tank.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.fuel_inventory_postings AS posting
        JOIN public.fuel_inventory_operations AS operation
          ON operation.id = posting.operation_id
        WHERE posting.fuel_tank_id = tank.id
          AND operation.operation_type = 'OPENING'
          AND NOT EXISTS (
            SELECT 1 FROM public.fuel_inventory_voids AS voided
            WHERE voided.operation_id = operation.id
          )
      );
    IF target_tank_ids IS NULL THEN
      RAISE EXCEPTION 'Every active fuel tank is already initialized';
    END IF;
  ELSE
    target_tank_ids := active_tank_ids;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_openings) AS opening(
      fuel_tank_id UUID, amount_litres NUMERIC
    )
    LEFT JOIN public.fuel_tanks AS tank ON tank.id = opening.fuel_tank_id
    WHERE tank.id IS NULL OR NOT (tank.id = ANY(target_tank_ids))
      OR tank.vessel_id <> p_vessel_id OR tank.archived_at IS NOT NULL
      OR opening.amount_litres > tank.capacity_litres
  ) THEN
    RAISE EXCEPTION 'Opening levels must cover uninitialized active vessel tanks and remain within capacity';
  END IF;
  IF (
    SELECT count(*) FROM jsonb_to_recordset(p_openings) AS opening(
      fuel_tank_id UUID, amount_litres NUMERIC
    )
  ) <> cardinality(target_tank_ids) THEN
    RAISE EXCEPTION 'Opening levels must cover every uninitialized active vessel tank exactly once';
  END IF;

  PERFORM public._lock_fuel_inventory_tanks(target_tank_ids);
  IF EXISTS (
    SELECT 1 FROM public.fuel_inventory_postings AS posting
    JOIN public.fuel_inventory_operations AS operation ON operation.id = posting.operation_id
    WHERE posting.fuel_tank_id = ANY(target_tank_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.fuel_inventory_voids AS voided
        WHERE voided.operation_id = operation.id
      )
  ) THEN
    RAISE EXCEPTION 'Opening levels cannot be added after inventory activity';
  END IF;

  actor_name := public._fuel_inventory_actor_name();
  INSERT INTO public.fuel_inventory_operations (
    id, vessel_id, logical_operation_id, revision_no, operation_type,
    effective_at, utc_offset_minutes, metadata, client_request_id,
    request_fingerprint, created_by, created_by_name
  ) VALUES (
    operation_id, p_vessel_id, operation_id, 1, 'OPENING',
    p_effective_at, p_utc_offset_minutes,
    jsonb_build_object('notes', COALESCE(btrim(p_notes), '')),
    p_client_request_id, request_fingerprint, auth.uid(), actor_name
  );

  INSERT INTO public.fuel_inventory_postings (
    operation_id, vessel_id, fuel_tank_id, posting_mode,
    amount_litres, tank_name_snapshot
  )
  SELECT operation_id, p_vessel_id, tank.id, 'ABSOLUTE',
    opening.amount_litres, tank.name
  FROM jsonb_to_recordset(p_openings) AS opening(
    fuel_tank_id UUID, amount_litres NUMERIC
  )
  JOIN public.fuel_tanks AS tank ON tank.id = opening.fuel_tank_id;

  PERFORM public._validate_fuel_inventory_operation(operation_id);
  PERFORM public._validate_fuel_inventory_timelines(target_tank_ids);

  INSERT INTO public.vessel_fuel_settings (vessel_id, volume_unit, inventory_activated_at)
  VALUES (p_vessel_id, 'LITRES', p_effective_at)
  ON CONFLICT (vessel_id) DO UPDATE
    SET inventory_activated_at = COALESCE(
      vessel_fuel_settings.inventory_activated_at,
      EXCLUDED.inventory_activated_at
    );

  RETURN public.get_fuel_inventory_snapshot(p_vessel_id, now());
END;
$$;

REVOKE ALL ON FUNCTION public.activate_vessel_fuel_inventory(
  UUID, TIMESTAMPTZ, SMALLINT, JSONB, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_vessel_fuel_inventory(
  UUID, TIMESTAMPTZ, SMALLINT, JSONB, TEXT, UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION public.amend_fuel_inventory_opening(
  p_operation_id UUID,
  p_expected_revision INTEGER,
  p_effective_at TIMESTAMPTZ,
  p_utc_offset_minutes SMALLINT,
  p_openings JSONB,
  p_notes TEXT,
  p_amendment_reason TEXT,
  p_client_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing public.fuel_inventory_operations%ROWTYPE;
  replacement_id UUID := gen_random_uuid();
  old_tank_ids UUID[];
  new_tank_ids UUID[];
  request_payload JSONB;
  request_fingerprint TEXT;
  duplicate_operation_id UUID;
  actor_name TEXT;
  is_initial_activation BOOLEAN;
BEGIN
  SELECT * INTO existing
  FROM public.fuel_inventory_operations
  WHERE id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND OR existing.operation_type <> 'OPENING' THEN
    RAISE EXCEPTION 'Only an opening operation uses this amendment RPC';
  END IF;
  IF NOT public.current_user_can_manage_vessel(existing.vessel_id) THEN
    RAISE EXCEPTION 'Only an HOD or Captain/MOV can amend fuel opening levels';
  END IF;
  PERFORM public._validate_fuel_inventory_effective_time(
    p_effective_at, p_utc_offset_minutes
  );
  IF p_openings IS NULL OR jsonb_typeof(p_openings) <> 'array'
    OR jsonb_array_length(p_openings) = 0 THEN
    RAISE EXCEPTION 'Replacement opening levels are required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_openings) AS opening(
      fuel_tank_id UUID, amount_litres NUMERIC
    )
    WHERE fuel_tank_id IS NULL OR amount_litres IS NULL OR amount_litres < 0
  ) OR EXISTS (
    SELECT 1 FROM (
      SELECT fuel_tank_id
      FROM jsonb_to_recordset(p_openings) AS opening(
        fuel_tank_id UUID, amount_litres NUMERIC
      )
      GROUP BY fuel_tank_id HAVING count(*) > 1
    ) AS duplicates
  ) THEN
    RAISE EXCEPTION 'Replacement openings require one non-negative level per tank';
  END IF;
  IF COALESCE(btrim(p_amendment_reason), '') = ''
    OR char_length(p_amendment_reason) > 2000
    OR char_length(COALESCE(p_notes, '')) > 2000 THEN
    RAISE EXCEPTION 'A concise opening amendment reason and valid notes are required';
  END IF;

  request_payload := jsonb_build_object(
    'rpc', 'amend_fuel_inventory_opening',
    'operation_id', p_operation_id,
    'expected_revision', p_expected_revision,
    'effective_at', p_effective_at,
    'utc_offset_minutes', p_utc_offset_minutes,
    'openings', p_openings,
    'notes', COALESCE(btrim(p_notes), ''),
    'amendment_reason', btrim(p_amendment_reason)
  );
  request_fingerprint := public._fuel_inventory_request_fingerprint(request_payload);
  duplicate_operation_id := public._fuel_inventory_existing_request(
    existing.vessel_id, p_client_request_id, request_fingerprint
  );
  IF duplicate_operation_id IS NOT NULL THEN
    RETURN public._fuel_inventory_operation_json(duplicate_operation_id);
  END IF;

  IF existing.revision_no IS DISTINCT FROM p_expected_revision OR EXISTS (
    SELECT 1 FROM public.fuel_inventory_voids WHERE operation_id = existing.id
  ) OR EXISTS (
    SELECT 1
    FROM public.fuel_inventory_operations AS later
    WHERE later.logical_operation_id = existing.logical_operation_id
      AND later.revision_no > existing.revision_no
      AND NOT EXISTS (
        SELECT 1 FROM public.fuel_inventory_voids AS voided
        WHERE voided.operation_id = later.id
      )
  ) THEN
    RAISE EXCEPTION 'Fuel opening levels changed since they were loaded; refresh and try again';
  END IF;

  SELECT array_agg(fuel_tank_id ORDER BY fuel_tank_id)
  INTO old_tank_ids
  FROM public.fuel_inventory_postings
  WHERE operation_id = existing.id;
  SELECT array_agg(fuel_tank_id ORDER BY fuel_tank_id)
  INTO new_tank_ids
  FROM jsonb_to_recordset(p_openings) AS opening(
    fuel_tank_id UUID, amount_litres NUMERIC
  );
  IF old_tank_ids IS DISTINCT FROM new_tank_ids THEN
    RAISE EXCEPTION 'An opening amendment must preserve exactly the original tank set';
  END IF;
  SELECT existing.logical_operation_id = first_opening.logical_operation_id
  INTO is_initial_activation
  FROM (
    SELECT operation.logical_operation_id
    FROM public.fuel_inventory_operations AS operation
    WHERE operation.vessel_id = existing.vessel_id
      AND operation.operation_type = 'OPENING'
    ORDER BY operation.recorded_sequence
    LIMIT 1
  ) AS first_opening;

  PERFORM public._lock_fuel_inventory_vessel(existing.vessel_id);
  PERFORM public._lock_fuel_inventory_tanks(old_tank_ids);
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_openings) AS opening(
      fuel_tank_id UUID, amount_litres NUMERIC
    )
    LEFT JOIN public.fuel_tanks AS tank ON tank.id = opening.fuel_tank_id
    WHERE tank.id IS NULL OR tank.vessel_id <> existing.vessel_id
      OR opening.amount_litres > tank.capacity_litres
  ) THEN
    RAISE EXCEPTION 'Replacement opening levels must remain within vessel tank capacities';
  END IF;

  actor_name := public._fuel_inventory_actor_name();
  INSERT INTO public.fuel_inventory_operations (
    id, vessel_id, logical_operation_id, revision_no, operation_type,
    effective_at, effective_order, utc_offset_minutes,
    supersedes_operation_id, metadata, client_request_id,
    request_fingerprint, created_by, created_by_name
  ) VALUES (
    replacement_id, existing.vessel_id, existing.logical_operation_id,
    existing.revision_no + 1, 'OPENING', p_effective_at,
    existing.effective_order, p_utc_offset_minutes, existing.id,
    jsonb_build_object(
      'notes', COALESCE(btrim(p_notes), ''),
      'amendment_reason', btrim(p_amendment_reason)
    ),
    p_client_request_id, request_fingerprint, auth.uid(), actor_name
  );
  INSERT INTO public.fuel_inventory_postings (
    operation_id, vessel_id, fuel_tank_id, posting_mode,
    amount_litres, tank_name_snapshot
  )
  SELECT replacement_id, existing.vessel_id, tank.id, 'ABSOLUTE',
    opening.amount_litres, tank.name
  FROM jsonb_to_recordset(p_openings) AS opening(
    fuel_tank_id UUID, amount_litres NUMERIC
  )
  JOIN public.fuel_tanks AS tank ON tank.id = opening.fuel_tank_id;
  INSERT INTO public.fuel_inventory_voids (
    vessel_id, operation_id, void_kind, reason, client_request_id,
    request_fingerprint, created_by, created_by_name
  ) VALUES (
    existing.vessel_id, existing.id, 'AMENDMENT', btrim(p_amendment_reason),
    p_client_request_id, request_fingerprint, auth.uid(), actor_name
  );

  PERFORM public._validate_fuel_inventory_operation(replacement_id);
  PERFORM public._validate_fuel_inventory_timelines(old_tank_ids);
  IF COALESCE(is_initial_activation, FALSE) THEN
    UPDATE public.vessel_fuel_settings AS settings
    SET inventory_activated_at = p_effective_at
    WHERE settings.vessel_id = existing.vessel_id;
  END IF;
  RETURN public._fuel_inventory_operation_json(replacement_id);
END;
$$;

REVOKE ALL ON FUNCTION public.amend_fuel_inventory_opening(
  UUID, INTEGER, TIMESTAMPTZ, SMALLINT, JSONB, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amend_fuel_inventory_opening(
  UUID, INTEGER, TIMESTAMPTZ, SMALLINT, JSONB, TEXT, TEXT, UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_fuel_inventory_entry(
  p_vessel_id UUID,
  p_entry_type TEXT,
  p_effective_at TIMESTAMPTZ,
  p_utc_offset_minutes SMALLINT,
  p_fuel_tank_id UUID,
  p_amount_litres NUMERIC,
  p_location TEXT,
  p_reason TEXT,
  p_notes TEXT,
  p_client_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_type TEXT := upper(COALESCE(btrim(p_entry_type), ''));
  posting_mode TEXT;
  posting_amount NUMERIC;
  actor_name TEXT;
  request_payload JSONB;
  request_fingerprint TEXT;
  existing_operation_id UUID;
  operation_id UUID := gen_random_uuid();
  tank_row public.fuel_tanks%ROWTYPE;
BEGIN
  IF p_vessel_id IS NULL OR NOT public.current_user_can_access_vessel(p_vessel_id) THEN
    RAISE EXCEPTION 'Only active vessel members can record fuel inventory entries';
  END IF;
  IF normalized_type NOT IN ('SOUNDING', 'CONSUMPTION', 'ADJUSTMENT') THEN
    RAISE EXCEPTION 'Fuel inventory entry type is invalid';
  END IF;
  IF normalized_type = 'ADJUSTMENT'
    AND NOT public.current_user_can_manage_vessel(p_vessel_id) THEN
    RAISE EXCEPTION 'Only an HOD or Captain/MOV can record adjustments';
  END IF;
  IF p_fuel_tank_id IS NULL OR p_amount_litres IS NULL THEN
    RAISE EXCEPTION 'Effective time, tank, and amount are required';
  END IF;
  PERFORM public._validate_fuel_inventory_effective_time(
    p_effective_at, p_utc_offset_minutes
  );
  IF normalized_type = 'SOUNDING' AND p_amount_litres < 0 THEN
    RAISE EXCEPTION 'Sounding level cannot be negative';
  END IF;
  IF normalized_type = 'CONSUMPTION' AND p_amount_litres <= 0 THEN
    RAISE EXCEPTION 'Consumption must be greater than zero';
  END IF;
  IF normalized_type = 'ADJUSTMENT' AND p_amount_litres = 0 THEN
    RAISE EXCEPTION 'Adjustment amount cannot be zero';
  END IF;
  IF normalized_type = 'ADJUSTMENT' AND COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'An adjustment reason is required';
  END IF;
  IF char_length(COALESCE(p_location, '')) > 240
    OR char_length(COALESCE(p_reason, '')) > 2000
    OR char_length(COALESCE(p_notes, '')) > 2000 THEN
    RAISE EXCEPTION 'Fuel inventory entry text is too long';
  END IF;

  posting_mode := CASE WHEN normalized_type = 'SOUNDING'
    THEN 'ABSOLUTE' ELSE 'DELTA' END;
  posting_amount := CASE WHEN normalized_type = 'CONSUMPTION'
    THEN -p_amount_litres ELSE p_amount_litres END;

  request_payload := jsonb_build_object(
    'rpc', 'record_fuel_inventory_entry',
    'vessel_id', p_vessel_id,
    'entry_type', normalized_type,
    'effective_at', p_effective_at,
    'utc_offset_minutes', p_utc_offset_minutes,
    'fuel_tank_id', p_fuel_tank_id,
    'amount_litres', p_amount_litres,
    'location', COALESCE(btrim(p_location), ''),
    'reason', COALESCE(btrim(p_reason), ''),
    'notes', COALESCE(btrim(p_notes), '')
  );
  request_fingerprint := public._fuel_inventory_request_fingerprint(request_payload);
  existing_operation_id := public._fuel_inventory_existing_request(
    p_vessel_id, p_client_request_id, request_fingerprint
  );
  IF existing_operation_id IS NOT NULL THEN
    RETURN public._fuel_inventory_operation_json(existing_operation_id);
  END IF;

  PERFORM public._lock_fuel_inventory_vessel(p_vessel_id);
  PERFORM public._lock_fuel_inventory_tanks(ARRAY[p_fuel_tank_id]);
  SELECT * INTO tank_row
  FROM public.fuel_tanks
  WHERE id = p_fuel_tank_id
    AND vessel_id = p_vessel_id
    AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fuel tank was not found on the active vessel'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vessel_fuel_settings
    WHERE vessel_id = p_vessel_id AND inventory_activated_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Activate vessel fuel inventory before recording entries';
  END IF;

  actor_name := public._fuel_inventory_actor_name();
  INSERT INTO public.fuel_inventory_operations (
    id, vessel_id, logical_operation_id, revision_no, operation_type,
    effective_at, utc_offset_minutes, metadata, client_request_id,
    request_fingerprint, created_by, created_by_name
  ) VALUES (
    operation_id, p_vessel_id, operation_id, 1, normalized_type,
    p_effective_at, p_utc_offset_minutes,
    jsonb_build_object(
      'location', COALESCE(btrim(p_location), ''),
      'reason', COALESCE(btrim(p_reason), ''),
      'notes', COALESCE(btrim(p_notes), '')
    ),
    p_client_request_id, request_fingerprint, auth.uid(), actor_name
  );
  INSERT INTO public.fuel_inventory_postings (
    operation_id, vessel_id, fuel_tank_id, posting_mode,
    amount_litres, tank_name_snapshot
  ) VALUES (
    operation_id, p_vessel_id, p_fuel_tank_id, posting_mode,
    posting_amount, tank_row.name
  );

  PERFORM public._validate_fuel_inventory_operation(operation_id);
  PERFORM public._validate_fuel_inventory_timelines(ARRAY[p_fuel_tank_id]);
  RETURN public._fuel_inventory_operation_json(operation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.record_fuel_inventory_entry(
  UUID, TEXT, TIMESTAMPTZ, SMALLINT, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_fuel_inventory_entry(
  UUID, TEXT, TIMESTAMPTZ, SMALLINT, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_fuel_transfer(
  p_transfer JSONB,
  p_client_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_vessel_id UUID := (p_transfer ->> 'vessel_id')::UUID;
  source_tank_id UUID := (p_transfer ->> 'source_tank_id')::UUID;
  destination_tank_id UUID := (p_transfer ->> 'destination_tank_id')::UUID;
  amount_litres NUMERIC := (p_transfer ->> 'amount_litres')::NUMERIC;
  effective_at TIMESTAMPTZ := (p_transfer ->> 'effective_at')::TIMESTAMPTZ;
  utc_offset_minutes SMALLINT := (p_transfer ->> 'utc_offset_minutes')::SMALLINT;
  transfer_date DATE := (p_transfer ->> 'transfer_date')::DATE;
  transfer_time TIME := (p_transfer ->> 'transfer_time')::TIME;
  location_value TEXT := COALESCE(btrim(p_transfer ->> 'location'), '');
  notes_value TEXT := COALESCE(btrim(p_transfer ->> 'notes'), '');
  request_payload JSONB;
  request_fingerprint TEXT;
  existing_request_result JSONB;
  existing_operation_id UUID;
  existing_transfer JSONB;
  inventory_active BOOLEAN;
  actor_name TEXT;
  operation_id UUID := gen_random_uuid();
  transfer_row public.fuel_transfers%ROWTYPE;
  source_name TEXT;
  destination_name TEXT;
BEGIN
  IF p_transfer IS NULL OR jsonb_typeof(p_transfer) <> 'object' THEN
    RAISE EXCEPTION 'Fuel transfer must be supplied as an object';
  END IF;
  IF target_vessel_id IS NULL
    OR NOT public.current_user_can_access_vessel(target_vessel_id) THEN
    RAISE EXCEPTION 'Only active vessel members can record fuel transfers';
  END IF;
  IF source_tank_id IS NULL OR destination_tank_id IS NULL
    OR source_tank_id = destination_tank_id THEN
    RAISE EXCEPTION 'Source and destination tanks must be different';
  END IF;
  IF amount_litres IS NULL OR amount_litres <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero';
  END IF;
  IF transfer_date IS NULL OR transfer_time IS NULL THEN
    RAISE EXCEPTION 'Transfer effective time, local date, and local time are required';
  END IF;
  PERFORM public._validate_fuel_inventory_effective_time(
    effective_at, utc_offset_minutes, transfer_date, transfer_time
  );
  IF char_length(location_value) > 240 OR char_length(notes_value) > 2000 THEN
    RAISE EXCEPTION 'Fuel transfer text is too long';
  END IF;

  request_payload := jsonb_build_object(
    'rpc', 'record_fuel_transfer', 'transfer', p_transfer
  );
  request_fingerprint := public._fuel_inventory_request_fingerprint(request_payload);
  existing_request_result := public._fuel_inventory_existing_request_result(
    target_vessel_id, p_client_request_id, 'LEGACY_TRANSFER_CREATE',
    request_fingerprint
  );
  IF existing_request_result IS NOT NULL THEN
    RETURN existing_request_result;
  END IF;
  existing_operation_id := public._fuel_inventory_existing_request(
    target_vessel_id, p_client_request_id, request_fingerprint
  );
  IF existing_operation_id IS NOT NULL THEN
    SELECT to_jsonb(transfer) INTO existing_transfer
    FROM public.fuel_transfers AS transfer
    JOIN public.fuel_inventory_operations AS operation
      ON operation.source_fuel_transfer_id = transfer.id
    WHERE operation.id = existing_operation_id;
    RETURN existing_transfer;
  END IF;

  PERFORM public._lock_fuel_inventory_vessel(target_vessel_id);
  PERFORM public._lock_fuel_inventory_tanks(
    ARRAY[source_tank_id, destination_tank_id]
  );
  SELECT tank.name INTO source_name FROM public.fuel_tanks AS tank
  WHERE tank.id = source_tank_id
    AND tank.vessel_id = target_vessel_id
    AND tank.archived_at IS NULL
    AND effective_at >= date_trunc('minute', tank.created_at);
  SELECT tank.name INTO destination_name FROM public.fuel_tanks AS tank
  WHERE tank.id = destination_tank_id
    AND tank.vessel_id = target_vessel_id
    AND tank.archived_at IS NULL
    AND effective_at >= date_trunc('minute', tank.created_at);
  IF source_name IS NULL OR destination_name IS NULL THEN
    RAISE EXCEPTION 'Transfer tanks must be active on the vessel at the ship time';
  END IF;
  SELECT settings.inventory_activated_at IS NOT NULL INTO inventory_active
  FROM public.vessel_fuel_settings AS settings
  WHERE settings.vessel_id = target_vessel_id;

  actor_name := public._fuel_inventory_actor_name();
  PERFORM set_config('nautical.fuel_inventory_rpc', 'on', TRUE);

  INSERT INTO public.fuel_transfers (
    vessel_id, source_tank_id, destination_tank_id, amount_litres,
    effective_at, utc_offset_minutes,
    transfer_date, transfer_time, location, notes
  ) VALUES (
    target_vessel_id, source_tank_id, destination_tank_id, amount_litres,
    effective_at, utc_offset_minutes,
    transfer_date, transfer_time, location_value, notes_value
  ) RETURNING * INTO transfer_row;

  -- Before explicit opening levels exist, a transfer is useful operational
  -- evidence but cannot truthfully change an unknown balance. Persist the
  -- report row and its durable response only. The vessel lock above makes
  -- this decision atomic with activation: whichever transaction wins decides
  -- whether this request is report-only or part of the ledger.
  IF NOT COALESCE(inventory_active, FALSE) THEN
    INSERT INTO public.fuel_inventory_request_results (
      vessel_id, client_request_id, request_kind, request_fingerprint,
      result_payload, created_by
    ) VALUES (
      target_vessel_id, p_client_request_id, 'LEGACY_TRANSFER_CREATE',
      request_fingerprint, to_jsonb(transfer_row), auth.uid()
    );
    RETURN to_jsonb(transfer_row);
  END IF;

  INSERT INTO public.fuel_inventory_operations (
    id, vessel_id, logical_operation_id, revision_no, operation_type,
    effective_at, utc_offset_minutes, source_fuel_transfer_id, metadata,
    client_request_id, request_fingerprint, created_by, created_by_name
  ) VALUES (
    operation_id, target_vessel_id, operation_id, 1, 'TRANSFER',
    effective_at, utc_offset_minutes, transfer_row.id,
    jsonb_build_object(
      'transfer_date', transfer_date,
      'transfer_time', transfer_time,
      'location', location_value,
      'notes', notes_value
    ),
    p_client_request_id, request_fingerprint, auth.uid(), actor_name
  );
  INSERT INTO public.fuel_inventory_postings (
    operation_id, vessel_id, fuel_tank_id, posting_mode,
    amount_litres, tank_name_snapshot
  ) VALUES
    (operation_id, target_vessel_id, source_tank_id, 'DELTA',
      -amount_litres, source_name),
    (operation_id, target_vessel_id, destination_tank_id, 'DELTA',
      amount_litres, destination_name);

  PERFORM public._validate_fuel_inventory_operation(operation_id);
  PERFORM public._validate_fuel_inventory_timelines(
    ARRAY[source_tank_id, destination_tank_id]
  );
  UPDATE public.fuel_transfers
  SET current_inventory_operation_id = operation_id, inventory_revision = 1
  WHERE id = transfer_row.id
  RETURNING * INTO transfer_row;
  RETURN to_jsonb(transfer_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.amend_fuel_transfer(
  p_fuel_transfer_id UUID,
  p_expected_revision INTEGER,
  p_transfer JSONB,
  p_reason TEXT,
  p_client_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing public.fuel_transfers%ROWTYPE;
  old_operation public.fuel_inventory_operations%ROWTYPE;
  target_vessel_id UUID;
  new_source_tank_id UUID := (p_transfer ->> 'source_tank_id')::UUID;
  new_destination_tank_id UUID := (p_transfer ->> 'destination_tank_id')::UUID;
  new_amount_litres NUMERIC := (p_transfer ->> 'amount_litres')::NUMERIC;
  new_effective_at TIMESTAMPTZ := (p_transfer ->> 'effective_at')::TIMESTAMPTZ;
  new_utc_offset_minutes SMALLINT := (p_transfer ->> 'utc_offset_minutes')::SMALLINT;
  new_transfer_date DATE := (p_transfer ->> 'transfer_date')::DATE;
  new_transfer_time TIME := (p_transfer ->> 'transfer_time')::TIME;
  location_value TEXT := COALESCE(btrim(p_transfer ->> 'location'), '');
  notes_value TEXT := COALESCE(btrim(p_transfer ->> 'notes'), '');
  request_payload JSONB;
  request_fingerprint TEXT;
  legacy_request_result JSONB;
  duplicate_operation_id UUID;
  replacement_id UUID := gen_random_uuid();
  actor_name TEXT;
  source_name TEXT;
  destination_name TEXT;
  affected_tanks UUID[];
  updated public.fuel_transfers%ROWTYPE;
  legacy_before_snapshot JSONB;
  legacy_after_snapshot JSONB;
BEGIN
  IF p_fuel_transfer_id IS NULL OR p_transfer IS NULL
    OR jsonb_typeof(p_transfer) <> 'object' THEN
    RAISE EXCEPTION 'Fuel transfer amendment is invalid';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' OR char_length(p_reason) > 2000 THEN
    RAISE EXCEPTION 'A concise amendment reason is required';
  END IF;

  SELECT * INTO existing FROM public.fuel_transfers
  WHERE id = p_fuel_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fuel transfer was not found'; END IF;
  target_vessel_id := existing.vessel_id;
  IF NOT public.current_user_can_manage_vessel(target_vessel_id) THEN
    RAISE EXCEPTION 'Only an HOD or Captain/MOV can amend fuel transfers';
  END IF;

  IF new_source_tank_id IS NULL OR new_destination_tank_id IS NULL
    OR new_source_tank_id = new_destination_tank_id
    OR new_amount_litres IS NULL OR new_amount_litres <= 0 THEN
    RAISE EXCEPTION 'Transfer requires different tanks and a positive amount';
  END IF;
  IF new_transfer_date IS NULL OR new_transfer_time IS NULL THEN
    RAISE EXCEPTION 'Transfer effective time, local date, and local time are required';
  END IF;
  PERFORM public._validate_fuel_inventory_effective_time(
    new_effective_at, new_utc_offset_minutes, new_transfer_date, new_transfer_time
  );
  IF char_length(location_value) > 240 OR char_length(notes_value) > 2000 THEN
    RAISE EXCEPTION 'Fuel transfer text is too long';
  END IF;
  request_payload := jsonb_build_object(
    'rpc', 'amend_fuel_transfer',
    'fuel_transfer_id', p_fuel_transfer_id,
    'expected_revision', p_expected_revision,
    'transfer', p_transfer,
    'reason', btrim(p_reason)
  );
  request_fingerprint := public._fuel_inventory_request_fingerprint(request_payload);
  legacy_request_result := public._fuel_inventory_existing_request_result(
    target_vessel_id, p_client_request_id, 'LEGACY_TRANSFER_AMEND',
    request_fingerprint
  );
  IF legacy_request_result IS NOT NULL THEN
    RETURN legacy_request_result;
  END IF;
  duplicate_operation_id := public._fuel_inventory_existing_request(
    target_vessel_id, p_client_request_id, request_fingerprint
  );
  IF duplicate_operation_id IS NOT NULL THEN
    SELECT to_jsonb(transfer) INTO request_payload
    FROM public.fuel_transfers AS transfer
    WHERE id = p_fuel_transfer_id;
    RETURN request_payload;
  END IF;

  PERFORM public._lock_fuel_inventory_vessel(target_vessel_id);

  IF existing.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Fuel transfer is already voided';
  END IF;
  IF existing.inventory_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Fuel transfer changed since it was loaded; refresh and try again';
  END IF;

  -- Rows created before inventory activation remain report-only.  Correcting
  -- them must never synthesize historical inventory movement, but they cannot
  -- become permanently trapped once direct table DML is revoked.
  IF existing.current_inventory_operation_id IS NULL THEN
    PERFORM public._lock_fuel_inventory_tanks(
      ARRAY[new_source_tank_id, new_destination_tank_id]
    );
    SELECT tank.name INTO source_name
    FROM public.fuel_tanks AS tank
    WHERE tank.id = new_source_tank_id
      AND tank.vessel_id = target_vessel_id
      AND new_effective_at >= date_trunc('minute', tank.created_at)
      AND (
        tank.archived_at IS NULL
        OR (
          tank.id IN (existing.source_tank_id, existing.destination_tank_id)
          AND new_effective_at < tank.archived_at
        )
      );
    SELECT tank.name INTO destination_name
    FROM public.fuel_tanks AS tank
    WHERE tank.id = new_destination_tank_id
      AND tank.vessel_id = target_vessel_id
      AND new_effective_at >= date_trunc('minute', tank.created_at)
      AND (
        tank.archived_at IS NULL
        OR (
          tank.id IN (existing.source_tank_id, existing.destination_tank_id)
          AND new_effective_at < tank.archived_at
        )
      );
    IF source_name IS NULL OR destination_name IS NULL THEN
      RAISE EXCEPTION 'Legacy transfer tanks must be available at the ship time';
    END IF;

    legacy_before_snapshot := public._fuel_inventory_legacy_transfer_snapshot(
      p_fuel_transfer_id
    );
    actor_name := public._fuel_inventory_actor_name();
    UPDATE public.fuel_transfers SET
      source_tank_id = new_source_tank_id,
      destination_tank_id = new_destination_tank_id,
      amount_litres = new_amount_litres,
      effective_at = new_effective_at,
      utc_offset_minutes = new_utc_offset_minutes,
      transfer_date = new_transfer_date,
      transfer_time = new_transfer_time,
      location = location_value,
      notes = notes_value,
      inventory_revision = existing.inventory_revision + 1
    WHERE id = p_fuel_transfer_id
    RETURNING * INTO updated;
    legacy_after_snapshot := public._fuel_inventory_legacy_transfer_snapshot(
      p_fuel_transfer_id
    );

    INSERT INTO public.fuel_inventory_legacy_source_audits (
      vessel_id, source_type, source_id, action, before_snapshot,
      after_snapshot, reason, client_request_id, created_by, created_by_name
    ) VALUES (
      target_vessel_id, 'FUEL_TRANSFER', p_fuel_transfer_id, 'AMENDMENT',
      legacy_before_snapshot, legacy_after_snapshot, btrim(p_reason),
      p_client_request_id, auth.uid(), actor_name
    );

    INSERT INTO public.fuel_inventory_request_results (
      vessel_id, client_request_id, request_kind, request_fingerprint,
      result_payload, created_by
    ) VALUES (
      target_vessel_id, p_client_request_id, 'LEGACY_TRANSFER_AMEND',
      request_fingerprint, to_jsonb(updated), auth.uid()
    );
    RETURN to_jsonb(updated);
  END IF;

  SELECT * INTO old_operation FROM public.fuel_inventory_operations
  WHERE id = existing.current_inventory_operation_id;

  SELECT array_agg(DISTINCT tank_id ORDER BY tank_id) INTO affected_tanks
  FROM (
    SELECT fuel_tank_id AS tank_id FROM public.fuel_inventory_postings
    WHERE operation_id = old_operation.id
    UNION ALL SELECT new_source_tank_id
    UNION ALL SELECT new_destination_tank_id
  ) AS ids;
  PERFORM public._lock_fuel_inventory_tanks(affected_tanks);
  SELECT tank.name INTO source_name FROM public.fuel_tanks AS tank
  WHERE tank.id = new_source_tank_id
    AND tank.vessel_id = target_vessel_id
    AND (
      tank.archived_at IS NULL
      OR EXISTS (
        SELECT 1 FROM public.fuel_inventory_postings AS old_posting
        WHERE old_posting.operation_id = old_operation.id
          AND old_posting.fuel_tank_id = tank.id
      )
    );
  SELECT tank.name INTO destination_name FROM public.fuel_tanks AS tank
  WHERE tank.id = new_destination_tank_id
    AND tank.vessel_id = target_vessel_id
    AND (
      tank.archived_at IS NULL
      OR EXISTS (
        SELECT 1 FROM public.fuel_inventory_postings AS old_posting
        WHERE old_posting.operation_id = old_operation.id
          AND old_posting.fuel_tank_id = tank.id
      )
    );
  IF source_name IS NULL OR destination_name IS NULL THEN
    RAISE EXCEPTION 'Transfer amendments may only use active tanks or retained source tanks';
  END IF;
  actor_name := public._fuel_inventory_actor_name();

  INSERT INTO public.fuel_inventory_operations (
    id, vessel_id, logical_operation_id, revision_no, operation_type,
    effective_at, effective_order, utc_offset_minutes,
    source_fuel_transfer_id, supersedes_operation_id, metadata,
    client_request_id, request_fingerprint, created_by, created_by_name
  ) VALUES (
    replacement_id, target_vessel_id, old_operation.logical_operation_id,
    old_operation.revision_no + 1, 'TRANSFER', new_effective_at,
    old_operation.effective_order, new_utc_offset_minutes, p_fuel_transfer_id,
    old_operation.id,
    jsonb_build_object(
      'transfer_date', new_transfer_date, 'transfer_time', new_transfer_time,
      'location', location_value, 'notes', notes_value,
      'amendment_reason', btrim(p_reason)
    ),
    p_client_request_id, request_fingerprint, auth.uid(), actor_name
  );
  INSERT INTO public.fuel_inventory_postings (
    operation_id, vessel_id, fuel_tank_id, posting_mode,
    amount_litres, tank_name_snapshot
  ) VALUES
    (replacement_id, target_vessel_id, new_source_tank_id, 'DELTA',
      -new_amount_litres, source_name),
    (replacement_id, target_vessel_id, new_destination_tank_id, 'DELTA',
      new_amount_litres, destination_name);
  INSERT INTO public.fuel_inventory_voids (
    vessel_id, operation_id, void_kind, reason, client_request_id,
    request_fingerprint, created_by, created_by_name
  ) VALUES (
    target_vessel_id, old_operation.id, 'AMENDMENT', btrim(p_reason),
    p_client_request_id, request_fingerprint, auth.uid(), actor_name
  );

  PERFORM public._validate_fuel_inventory_operation(replacement_id);
  PERFORM public._validate_fuel_inventory_timelines(affected_tanks);
  PERFORM set_config('nautical.fuel_inventory_rpc', 'on', TRUE);
  UPDATE public.fuel_transfers SET
    source_tank_id = new_source_tank_id,
    destination_tank_id = new_destination_tank_id,
    amount_litres = new_amount_litres,
    effective_at = new_effective_at,
    utc_offset_minutes = new_utc_offset_minutes,
    transfer_date = new_transfer_date,
    transfer_time = new_transfer_time,
    location = location_value,
    notes = notes_value,
    current_inventory_operation_id = replacement_id,
    inventory_revision = old_operation.revision_no + 1
  WHERE id = p_fuel_transfer_id
  RETURNING * INTO updated;
  RETURN to_jsonb(updated);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_fuel_transfer(
  p_fuel_transfer_id UUID,
  p_expected_revision INTEGER,
  p_reason TEXT,
  p_client_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing public.fuel_transfers%ROWTYPE;
  current_operation_id UUID;
  affected_tanks UUID[];
  actor_name TEXT;
  request_payload JSONB;
  request_fingerprint TEXT;
  legacy_request_result JSONB;
  duplicate_operation_id UUID;
  legacy_before_snapshot JSONB;
  legacy_after_snapshot JSONB;
BEGIN
  IF COALESCE(btrim(p_reason), '') = '' OR char_length(p_reason) > 2000 THEN
    RAISE EXCEPTION 'A concise void reason is required';
  END IF;
  SELECT * INTO existing FROM public.fuel_transfers
  WHERE id = p_fuel_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fuel transfer was not found'; END IF;
  IF NOT public.current_user_can_manage_vessel(existing.vessel_id) THEN
    RAISE EXCEPTION 'Only an HOD or Captain/MOV can void fuel transfers';
  END IF;

  request_payload := jsonb_build_object(
    'rpc', 'void_fuel_transfer', 'fuel_transfer_id', p_fuel_transfer_id,
    'expected_revision', p_expected_revision, 'reason', btrim(p_reason)
  );
  request_fingerprint := public._fuel_inventory_request_fingerprint(request_payload);
  legacy_request_result := public._fuel_inventory_existing_request_result(
    existing.vessel_id, p_client_request_id, 'LEGACY_TRANSFER_VOID',
    request_fingerprint
  );
  IF legacy_request_result IS NOT NULL THEN
    RETURN legacy_request_result;
  END IF;
  duplicate_operation_id := public._fuel_inventory_existing_request(
    existing.vessel_id, p_client_request_id, request_fingerprint
  );
  IF duplicate_operation_id IS NOT NULL THEN
    RETURN to_jsonb(existing);
  END IF;

  PERFORM public._lock_fuel_inventory_vessel(existing.vessel_id);
  IF existing.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Fuel transfer is already voided';
  END IF;
  IF existing.inventory_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Fuel transfer changed since it was loaded; refresh and try again';
  END IF;

  IF existing.current_inventory_operation_id IS NULL THEN
    actor_name := public._fuel_inventory_actor_name();
    legacy_before_snapshot := public._fuel_inventory_legacy_transfer_snapshot(
      p_fuel_transfer_id
    );
    UPDATE public.fuel_transfers SET
      voided_at = now(), voided_by = auth.uid(), voided_by_name = actor_name
    WHERE id = p_fuel_transfer_id
    RETURNING * INTO existing;
    legacy_after_snapshot := public._fuel_inventory_legacy_transfer_snapshot(
      p_fuel_transfer_id
    );
    INSERT INTO public.fuel_inventory_legacy_source_audits (
      vessel_id, source_type, source_id, action, before_snapshot,
      after_snapshot, reason, client_request_id, created_by, created_by_name
    ) VALUES (
      existing.vessel_id, 'FUEL_TRANSFER', p_fuel_transfer_id, 'VOID',
      legacy_before_snapshot, legacy_after_snapshot, btrim(p_reason),
      p_client_request_id, auth.uid(), actor_name
    );
    INSERT INTO public.fuel_inventory_request_results (
      vessel_id, client_request_id, request_kind, request_fingerprint,
      result_payload, created_by
    ) VALUES (
      existing.vessel_id, p_client_request_id, 'LEGACY_TRANSFER_VOID',
      request_fingerprint, to_jsonb(existing), auth.uid()
    );
    RETURN to_jsonb(existing);
  END IF;

  current_operation_id := existing.current_inventory_operation_id;
  SELECT array_agg(posting.fuel_tank_id ORDER BY posting.fuel_tank_id)
  INTO affected_tanks
  FROM public.fuel_inventory_postings AS posting
  WHERE posting.operation_id = current_operation_id;
  PERFORM public._lock_fuel_inventory_tanks(affected_tanks);
  actor_name := public._fuel_inventory_actor_name();
  INSERT INTO public.fuel_inventory_voids (
    vessel_id, operation_id, void_kind, reason, client_request_id,
    request_fingerprint, created_by, created_by_name
  ) VALUES (
    existing.vessel_id, current_operation_id, 'ERROR', btrim(p_reason),
    p_client_request_id, request_fingerprint, auth.uid(), actor_name
  );
  PERFORM public._validate_fuel_inventory_timelines(affected_tanks);
  PERFORM set_config('nautical.fuel_inventory_rpc', 'on', TRUE);
  UPDATE public.fuel_transfers SET
    voided_at = now(), voided_by = auth.uid(), voided_by_name = actor_name
  WHERE id = p_fuel_transfer_id
  RETURNING * INTO existing;
  RETURN to_jsonb(existing);
END;
$$;

REVOKE ALL ON FUNCTION public.record_fuel_transfer(JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.amend_fuel_transfer(UUID, INTEGER, JSONB, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_fuel_transfer(UUID, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_fuel_transfer(JSONB, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.amend_fuel_transfer(UUID, INTEGER, JSONB, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_fuel_transfer(UUID, INTEGER, TEXT, UUID) TO authenticated;

-- Retain the thoroughly validated parent/allocation writers from the
-- foundation migration as private implementation helpers.  Their public names
-- are replaced below with activation-aware ledger writers.
DO $$
BEGIN
  IF to_regprocedure('public._create_fuel_log_with_tank_entries_legacy(jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.create_fuel_log_with_tank_entries(JSONB, JSONB)
      RENAME TO _create_fuel_log_with_tank_entries_legacy;
  END IF;
  IF to_regprocedure(
    'public._update_fuel_log_with_tank_entries_legacy(uuid,uuid,jsonb,jsonb)'
  ) IS NULL THEN
    ALTER FUNCTION public.update_fuel_log_with_tank_entries(UUID, UUID, JSONB, JSONB)
      RENAME TO _update_fuel_log_with_tank_entries_legacy;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._create_fuel_log_with_tank_entries_legacy(JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._update_fuel_log_with_tank_entries_legacy(
  UUID, UUID, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;

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
  target_vessel_id UUID := (p_log ->> 'vessel_id')::UUID;
  inventory_active BOOLEAN;
  effective_at TIMESTAMPTZ;
  utc_offset_minutes SMALLINT;
  local_log_date DATE;
  local_log_time TIME;
  client_request_id UUID;
  request_payload JSONB;
  request_fingerprint TEXT;
  existing_request_result JSONB;
  existing_operation_id UUID;
  operation_id UUID := gen_random_uuid();
  actor_name TEXT;
  created_log JSONB;
  created_fuel_log_id UUID;
  tank_ids UUID[];
BEGIN
  IF p_log IS NULL OR jsonb_typeof(p_log) <> 'object' THEN
    RAISE EXCEPTION 'Fuel log must be supplied as an object';
  END IF;
  IF target_vessel_id IS NULL
    OR NOT public.current_user_can_access_vessel(target_vessel_id) THEN
    RAISE EXCEPTION 'Only active vessel members can create fuel logs';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array'
    OR (p_log ->> 'amount_of_fuel')::NUMERIC
      IS DISTINCT FROM round((p_log ->> 'amount_of_fuel')::NUMERIC, 3)
    OR EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_entries) AS entry(
        fuel_tank_id UUID, amount_litres NUMERIC
      )
      WHERE entry.amount_litres IS DISTINCT FROM round(entry.amount_litres, 3)
    ) THEN
    RAISE EXCEPTION 'Fuel receipt amounts support at most three decimal places';
  END IF;

  client_request_id := (p_log ->> 'client_request_id')::UUID;
  effective_at := NULLIF(p_log ->> 'effective_at', '')::TIMESTAMPTZ;
  utc_offset_minutes := NULLIF(p_log ->> 'utc_offset_minutes', '')::SMALLINT;
  local_log_date := (p_log ->> 'log_date')::DATE;
  local_log_time := (p_log ->> 'log_time')::TIME;
  IF client_request_id IS NOT NULL
    AND (effective_at IS NULL OR utc_offset_minutes IS NULL) THEN
    RAISE EXCEPTION 'Current fuel receipt requests require an effective time and UTC offset';
  END IF;
  IF (effective_at IS NULL) <> (utc_offset_minutes IS NULL) THEN
    RAISE EXCEPTION 'Fuel receipt effective time and UTC offset must be supplied together';
  END IF;
  IF effective_at IS NOT NULL THEN
    PERFORM public._validate_fuel_inventory_effective_time(
      effective_at, utc_offset_minutes, local_log_date, local_log_time
    );
  END IF;
  IF client_request_id IS NOT NULL THEN
    request_payload := jsonb_build_object(
      'rpc', 'create_fuel_log_with_tank_entries',
      'log', p_log - ARRAY['client_request_id'],
      'entries', p_entries
    );
    request_fingerprint := public._fuel_inventory_request_fingerprint(request_payload);
    existing_request_result := public._fuel_inventory_existing_request_result(
      target_vessel_id, client_request_id, 'LEGACY_REFUEL_CREATE',
      request_fingerprint
    );
    IF existing_request_result IS NOT NULL THEN
      RETURN existing_request_result;
    END IF;
    existing_operation_id := public._fuel_inventory_existing_request(
      target_vessel_id, client_request_id, request_fingerprint
    );
    IF existing_operation_id IS NOT NULL THEN
      SELECT to_jsonb(fuel_log) INTO created_log
      FROM public.fuel_logs AS fuel_log
      JOIN public.fuel_inventory_operations AS operation
        ON operation.source_fuel_log_id = fuel_log.id
      WHERE operation.id = existing_operation_id;
      RETURN created_log;
    END IF;
  END IF;

  -- Serialize the activation boundary before choosing legacy or ledger mode.
  -- This closes the race where activation could commit after the earlier read
  -- but before a SECURITY DEFINER legacy receipt insert.
  PERFORM public._lock_fuel_inventory_vessel(target_vessel_id);
  SELECT settings.inventory_activated_at IS NOT NULL INTO inventory_active
  FROM public.vessel_fuel_settings AS settings
  WHERE settings.vessel_id = target_vessel_id;

  SELECT array_agg(DISTINCT fuel_tank_id ORDER BY fuel_tank_id) INTO tank_ids
  FROM jsonb_to_recordset(p_entries) AS entry(fuel_tank_id UUID, amount_litres NUMERIC);
  PERFORM public._lock_fuel_inventory_tanks(tank_ids);
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_entries) AS entry(fuel_tank_id UUID, amount_litres NUMERIC)
    LEFT JOIN public.fuel_tanks AS tank ON tank.id = entry.fuel_tank_id
    WHERE tank.id IS NULL
      OR tank.vessel_id <> target_vessel_id
      OR tank.archived_at IS NOT NULL
      OR (
        effective_at IS NOT NULL
        AND effective_at < date_trunc('minute', tank.created_at)
      )
  ) THEN
    RAISE EXCEPTION 'Fuel log allocations must use tanks active on the vessel at the ship time';
  END IF;

  IF NOT COALESCE(inventory_active, FALSE) THEN
    created_log := public._create_fuel_log_with_tank_entries_legacy(p_log, p_entries);
    created_fuel_log_id := (created_log ->> 'id')::UUID;
    UPDATE public.fuel_logs
    SET effective_at = NULLIF(p_log ->> 'effective_at', '')::TIMESTAMPTZ,
        utc_offset_minutes = NULLIF(p_log ->> 'utc_offset_minutes', '')::SMALLINT
    WHERE id = created_fuel_log_id;
    SELECT to_jsonb(fuel_log) INTO created_log
    FROM public.fuel_logs AS fuel_log WHERE id = created_fuel_log_id;
    IF client_request_id IS NOT NULL THEN
      INSERT INTO public.fuel_inventory_request_results (
        vessel_id, client_request_id, request_kind, request_fingerprint,
        result_payload, created_by
      ) VALUES (
        target_vessel_id, client_request_id, 'LEGACY_REFUEL_CREATE',
        request_fingerprint, created_log, auth.uid()
      );
    END IF;
    RETURN created_log;
  END IF;

  IF client_request_id IS NULL THEN
    RAISE EXCEPTION 'Activated fuel inventory requires effective_at and client_request_id';
  END IF;

  actor_name := public._fuel_inventory_actor_name();
  PERFORM set_config('nautical.fuel_inventory_rpc', 'on', TRUE);
  created_log := public._create_fuel_log_with_tank_entries_legacy(p_log, p_entries);
  created_fuel_log_id := (created_log ->> 'id')::UUID;

  INSERT INTO public.fuel_inventory_operations (
    id, vessel_id, logical_operation_id, revision_no, operation_type,
    effective_at, utc_offset_minutes, source_fuel_log_id, metadata,
    client_request_id, request_fingerprint, created_by, created_by_name
  ) VALUES (
    operation_id, target_vessel_id, operation_id, 1, 'REFUEL', effective_at,
    utc_offset_minutes, created_fuel_log_id,
    jsonb_build_object(
      'location', COALESCE(p_log ->> 'location_of_refueling', ''),
      'log_date', p_log ->> 'log_date',
      'log_time', p_log ->> 'log_time',
      'amount_of_fuel', created_log -> 'amount_of_fuel',
      'volume_unit', p_log ->> 'volume_unit',
      'price_per_volume_unit', p_log -> 'price_per_gallon',
      'total_price', p_log -> 'total_price',
      'currency_code', p_log ->> 'currency_code',
      'comment', COALESCE(p_log ->> 'comment', '')
    ),
    client_request_id, request_fingerprint, auth.uid(), actor_name
  );
  INSERT INTO public.fuel_inventory_postings (
    operation_id, vessel_id, fuel_tank_id, posting_mode,
    amount_litres, tank_name_snapshot
  )
  SELECT operation_id, target_vessel_id, tank.id, 'DELTA',
    entry.amount_litres, tank.name
  FROM public.fuel_log_tank_entries AS entry
  JOIN public.fuel_tanks AS tank ON tank.id = entry.fuel_tank_id
  WHERE entry.fuel_log_id = created_fuel_log_id;

  PERFORM public._validate_fuel_inventory_operation(operation_id);
  PERFORM public._validate_fuel_inventory_timelines(tank_ids);
  UPDATE public.fuel_logs
  SET effective_at = NULLIF(p_log ->> 'effective_at', '')::TIMESTAMPTZ,
      utc_offset_minutes = NULLIF(p_log ->> 'utc_offset_minutes', '')::SMALLINT,
      current_inventory_operation_id = operation_id,
      inventory_revision = 1
  WHERE id = created_fuel_log_id;
  SELECT to_jsonb(fuel_log) INTO created_log
  FROM public.fuel_logs AS fuel_log WHERE id = created_fuel_log_id;
  RETURN created_log;
END;
$$;

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
  existing public.fuel_logs%ROWTYPE;
  old_operation public.fuel_inventory_operations%ROWTYPE;
  effective_at TIMESTAMPTZ;
  utc_offset_minutes SMALLINT;
  local_log_date DATE;
  local_log_time TIME;
  client_request_id UUID;
  expected_revision INTEGER;
  amendment_reason TEXT;
  request_payload JSONB;
  request_fingerprint TEXT;
  legacy_request_result JSONB;
  duplicate_operation_id UUID;
  replacement_id UUID := gen_random_uuid();
  actor_name TEXT;
  affected_tanks UUID[];
  updated_log JSONB;
  legacy_before_snapshot JSONB;
  legacy_after_snapshot JSONB;
  existing_allocation_count BIGINT;
  requested_allocation_count INTEGER;
  legacy_location TEXT;
  legacy_log_date DATE;
  legacy_log_time TEXT;
  legacy_amount NUMERIC;
  legacy_price NUMERIC;
  legacy_total NUMERIC;
  legacy_volume_unit TEXT;
  legacy_currency_code TEXT;
  legacy_comment TEXT;
  inventory_active BOOLEAN;
  allow_unknown_time_metadata_correction BOOLEAN := FALSE;
BEGIN
  SELECT * INTO existing FROM public.fuel_logs
  WHERE id = p_fuel_log_id AND vessel_id = p_vessel_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fuel log was not found'; END IF;
  IF NOT public.current_user_can_access_vessel(p_vessel_id) THEN
    RAISE EXCEPTION 'Only active vessel members can update fuel logs';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array'
    OR COALESCE(
      (p_log_patch ->> 'amount_of_fuel')::NUMERIC,
      existing.amount_of_fuel
    ) IS DISTINCT FROM round(COALESCE(
      (p_log_patch ->> 'amount_of_fuel')::NUMERIC,
      existing.amount_of_fuel
    ), 3)
    OR EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_entries) AS entry(
        fuel_tank_id UUID, amount_litres NUMERIC
      )
      WHERE entry.amount_litres IS DISTINCT FROM round(entry.amount_litres, 3)
    ) THEN
    RAISE EXCEPTION 'Fuel receipt amounts support at most three decimal places';
  END IF;
  requested_allocation_count := jsonb_array_length(p_entries);

  expected_revision := (p_log_patch ->> 'expected_revision')::INTEGER;
  client_request_id := (p_log_patch ->> 'client_request_id')::UUID;
  amendment_reason := COALESCE(btrim(p_log_patch ->> 'amendment_reason'), '');

  -- The foundation client used this same four-argument RPC before optimistic
  -- revisions and durable request IDs existed. Keep that exact call shape
  -- working only for an untouched, pre-activation receipt. The vessel lock
  -- makes the activation check atomic with the legacy helper write, while a
  -- non-zero revision prevents an old client from overwriting a newer audited
  -- correction.
  IF expected_revision IS NULL
    AND client_request_id IS NULL
    AND amendment_reason = '' THEN
    PERFORM public._lock_fuel_inventory_vessel(p_vessel_id);
    SELECT settings.inventory_activated_at IS NOT NULL INTO inventory_active
    FROM public.vessel_fuel_settings AS settings
    WHERE settings.vessel_id = p_vessel_id;

    IF COALESCE(inventory_active, FALSE)
      OR existing.current_inventory_operation_id IS NOT NULL
      OR existing.inventory_revision <> 0 THEN
      RAISE EXCEPTION 'This fuel receipt requires the current app version before it can be changed';
    END IF;
    IF existing.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'Fuel log is already voided';
    END IF;

    -- An installed build may still use the original four-argument update
    -- shape during the rollout window. Re-check the requested allocations at
    -- write time so a tank archived after that build loaded setup cannot be
    -- selected. An already retained archived allocation remains editable; if
    -- the row has precise UTC evidence, that event must still fall inside the
    -- tank's recorded lifetime.
    local_log_date := CASE WHEN p_log_patch ? 'log_date'
      THEN (p_log_patch ->> 'log_date')::DATE ELSE existing.log_date END;
    local_log_time := CASE WHEN p_log_patch ? 'log_time'
      THEN (p_log_patch ->> 'log_time')::TIME ELSE existing.log_time::TIME END;
    IF existing.effective_at IS NOT NULL THEN
      effective_at := (
        (local_log_date + local_log_time)
          - make_interval(mins => existing.utc_offset_minutes)
      ) AT TIME ZONE 'UTC';
      PERFORM public._validate_fuel_inventory_effective_time(
        effective_at, existing.utc_offset_minutes, local_log_date, local_log_time
      );
    END IF;
    SELECT array_agg(DISTINCT tank_id ORDER BY tank_id) INTO affected_tanks
    FROM (
      SELECT entry.fuel_tank_id AS tank_id
      FROM jsonb_to_recordset(p_entries) AS entry(
        fuel_tank_id UUID, amount_litres NUMERIC
      )
      UNION ALL
      SELECT old_entry.fuel_tank_id
      FROM public.fuel_log_tank_entries AS old_entry
      WHERE old_entry.fuel_log_id = p_fuel_log_id
    ) AS allocation_tanks;
    PERFORM public._lock_fuel_inventory_tanks(affected_tanks);
    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_entries) AS entry(
        fuel_tank_id UUID, amount_litres NUMERIC
      )
      LEFT JOIN public.fuel_tanks AS tank ON tank.id = entry.fuel_tank_id
      WHERE tank.id IS NULL OR tank.vessel_id <> p_vessel_id
        OR (
          effective_at IS NOT NULL
          AND effective_at < date_trunc('minute', tank.created_at)
        )
        OR (
          tank.archived_at IS NOT NULL
          AND (
            NOT EXISTS (
              SELECT 1 FROM public.fuel_log_tank_entries AS old_entry
              WHERE old_entry.fuel_log_id = p_fuel_log_id
                AND old_entry.fuel_tank_id = tank.id
            )
            OR (
              effective_at IS NOT NULL
              AND effective_at >= tank.archived_at
            )
          )
        )
    ) THEN
      RAISE EXCEPTION 'Installed-client receipt updates require tanks available at the ship time';
    END IF;

    updated_log := public._update_fuel_log_with_tank_entries_legacy(
      p_fuel_log_id, p_vessel_id, p_log_patch, p_entries
    );
    IF existing.effective_at IS NOT NULL
      AND (p_log_patch ? 'log_date' OR p_log_patch ? 'log_time') THEN
      UPDATE public.fuel_logs AS fuel_log
      SET effective_at = (
        (fuel_log.log_date + fuel_log.log_time::TIME)
          - make_interval(mins => existing.utc_offset_minutes)
      ) AT TIME ZONE 'UTC',
          utc_offset_minutes = existing.utc_offset_minutes
      WHERE fuel_log.id = p_fuel_log_id;
      SELECT fuel_log.effective_at, fuel_log.utc_offset_minutes,
        fuel_log.log_date, fuel_log.log_time::TIME
      INTO effective_at, utc_offset_minutes, local_log_date, local_log_time
      FROM public.fuel_logs AS fuel_log
      WHERE fuel_log.id = p_fuel_log_id;
      PERFORM public._validate_fuel_inventory_effective_time(
        effective_at, utc_offset_minutes, local_log_date, local_log_time
      );
      SELECT to_jsonb(fuel_log) INTO updated_log
      FROM public.fuel_logs AS fuel_log WHERE fuel_log.id = p_fuel_log_id;
    END IF;
    RETURN updated_log;
  END IF;

  IF NOT public.current_user_can_manage_vessel(p_vessel_id) THEN
    RAISE EXCEPTION 'Only an HOD or Captain/MOV can amend fuel logs';
  END IF;

  IF expected_revision IS NULL OR client_request_id IS NULL OR amendment_reason = '' THEN
    RAISE EXCEPTION 'Fuel log amendment requires expected_revision, client_request_id, and amendment_reason';
  END IF;
  request_payload := jsonb_build_object(
    'rpc', 'update_fuel_log_with_tank_entries',
    'fuel_log_id', p_fuel_log_id,
    'vessel_id', p_vessel_id,
    'log_patch', p_log_patch - ARRAY['client_request_id'],
    'entries', p_entries
  );
  request_fingerprint := public._fuel_inventory_request_fingerprint(request_payload);
  legacy_request_result := public._fuel_inventory_existing_request_result(
    p_vessel_id, client_request_id, 'LEGACY_REFUEL_AMEND', request_fingerprint
  );
  IF legacy_request_result IS NOT NULL THEN
    RETURN legacy_request_result;
  END IF;
  duplicate_operation_id := public._fuel_inventory_existing_request(
    p_vessel_id, client_request_id, request_fingerprint
  );
  IF duplicate_operation_id IS NOT NULL THEN
    SELECT to_jsonb(fuel_log) INTO updated_log
    FROM public.fuel_logs AS fuel_log WHERE id = p_fuel_log_id;
    RETURN updated_log;
  END IF;

  PERFORM public._lock_fuel_inventory_vessel(p_vessel_id);
  IF existing.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Fuel log is already voided'; END IF;
  IF existing.inventory_revision IS DISTINCT FROM expected_revision THEN
    RAISE EXCEPTION 'Fuel log changed since it was loaded; refresh and try again';
  END IF;

  -- Pre-ledger rows remain report-only: correction updates their source and
  -- allocations, retains immutable before/after evidence, and never creates a
  -- ledger movement.
  IF existing.current_inventory_operation_id IS NULL THEN
    effective_at := COALESCE(
      NULLIF(p_log_patch ->> 'effective_at', '')::TIMESTAMPTZ,
      existing.effective_at
    );
    utc_offset_minutes := COALESCE(
      NULLIF(p_log_patch ->> 'utc_offset_minutes', '')::SMALLINT,
      existing.utc_offset_minutes
    );
    local_log_date := CASE WHEN p_log_patch ? 'log_date'
      THEN (p_log_patch ->> 'log_date')::DATE ELSE existing.log_date END;
    local_log_time := CASE WHEN p_log_patch ? 'log_time'
      THEN (p_log_patch ->> 'log_time')::TIME ELSE existing.log_time::TIME END;

    -- A genuinely pre-foundation row can have neither allocations nor a
    -- trustworthy UTC offset. Preserve that unknown history for a narrow
    -- metadata-only correction; allocation, quantity/unit, or event-time
    -- changes must establish precise ship-time evidence.
    IF requested_allocation_count = 0 THEN
      SELECT count(*) INTO existing_allocation_count
      FROM public.fuel_log_tank_entries AS entry
      WHERE entry.fuel_log_id = p_fuel_log_id;
      IF existing_allocation_count <> 0 THEN
        RAISE EXCEPTION 'At least one tank allocation is required';
      END IF;
      legacy_amount := CASE WHEN p_log_patch ? 'amount_of_fuel'
        THEN (p_log_patch ->> 'amount_of_fuel')::NUMERIC
        ELSE existing.amount_of_fuel END;
      legacy_volume_unit := CASE WHEN p_log_patch ? 'volume_unit'
        THEN p_log_patch ->> 'volume_unit' ELSE existing.volume_unit END;
      IF legacy_amount IS DISTINCT FROM existing.amount_of_fuel
        OR legacy_volume_unit IS DISTINCT FROM existing.volume_unit THEN
        RAISE EXCEPTION 'An unallocated legacy receipt amendment may only change report metadata';
      END IF;
      allow_unknown_time_metadata_correction :=
        effective_at IS NULL
        AND utc_offset_minutes IS NULL
        AND local_log_date IS NOT DISTINCT FROM existing.log_date
        AND local_log_time IS NOT DISTINCT FROM existing.log_time::TIME;
    END IF;

    IF NOT allow_unknown_time_metadata_correction
      AND (effective_at IS NULL OR utc_offset_minutes IS NULL) THEN
      RAISE EXCEPTION 'Current fuel receipt amendments require an effective time and UTC offset';
    END IF;
    IF effective_at IS NOT NULL THEN
      PERFORM public._validate_fuel_inventory_effective_time(
        effective_at, utc_offset_minutes, local_log_date, local_log_time
      );
    END IF;
    SELECT array_agg(DISTINCT fuel_tank_id ORDER BY fuel_tank_id)
    INTO affected_tanks
    FROM jsonb_to_recordset(p_entries) AS entry(
      fuel_tank_id UUID, amount_litres NUMERIC
    );
    PERFORM public._lock_fuel_inventory_tanks(affected_tanks);
    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_entries) AS entry(
        fuel_tank_id UUID, amount_litres NUMERIC
      )
      LEFT JOIN public.fuel_tanks AS tank ON tank.id = entry.fuel_tank_id
      WHERE tank.id IS NULL OR tank.vessel_id <> p_vessel_id
        OR effective_at < date_trunc('minute', tank.created_at)
        OR (
          tank.archived_at IS NOT NULL
          AND (
            effective_at >= tank.archived_at
            OR NOT EXISTS (
              SELECT 1 FROM public.fuel_log_tank_entries AS old_entry
              WHERE old_entry.fuel_log_id = p_fuel_log_id
                AND old_entry.fuel_tank_id = tank.id
            )
          )
        )
    ) THEN
      RAISE EXCEPTION 'Fuel receipt amendments require tanks available at the ship time';
    END IF;

    legacy_before_snapshot := public._fuel_inventory_legacy_fuel_log_snapshot(
      p_fuel_log_id
    );
    actor_name := public._fuel_inventory_actor_name();
    PERFORM set_config('nautical.fuel_inventory_rpc', 'on', TRUE);
    IF requested_allocation_count = 0 THEN
      -- A pre-foundation row can have no allocation and no trustworthy unit
      -- marker.  Permit report-metadata correction without coercing that
      -- historical amount into litres/gallons or inventing tank movements.
      -- Supplying allocations later still takes the normal tank-aware path.
      legacy_location := CASE WHEN p_log_patch ? 'location_of_refueling'
        THEN NULLIF(btrim(p_log_patch ->> 'location_of_refueling'), '')
        ELSE existing.location_of_refueling END;
      legacy_log_date := CASE WHEN p_log_patch ? 'log_date'
        THEN (p_log_patch ->> 'log_date')::DATE ELSE existing.log_date END;
      legacy_log_time := CASE WHEN p_log_patch ? 'log_time'
        THEN p_log_patch ->> 'log_time' ELSE existing.log_time END;
      legacy_price := CASE WHEN p_log_patch ? 'price_per_gallon'
        THEN (p_log_patch ->> 'price_per_gallon')::NUMERIC
        ELSE existing.price_per_gallon END;
      legacy_total := CASE WHEN p_log_patch ? 'total_price'
        THEN (p_log_patch ->> 'total_price')::NUMERIC
        ELSE existing.total_price END;
      legacy_currency_code := CASE WHEN p_log_patch ? 'currency_code'
        THEN upper(COALESCE(NULLIF(btrim(p_log_patch ->> 'currency_code'), ''), 'USD'))
        ELSE existing.currency_code END;
      legacy_comment := CASE WHEN p_log_patch ? 'comment'
        THEN COALESCE(btrim(p_log_patch ->> 'comment'), '')
        ELSE existing.comment END;
      IF legacy_log_date IS NULL OR legacy_log_time IS NULL
        OR btrim(legacy_log_time) = ''
        OR legacy_price IS NULL OR legacy_price < 0
        OR legacy_total IS NULL OR legacy_total < 0
        OR legacy_currency_code !~ '^[A-Z]{3}$'
        OR char_length(legacy_comment) > 2000 THEN
        RAISE EXCEPTION 'Legacy fuel log metadata is invalid';
      END IF;

      UPDATE public.fuel_logs SET
        location_of_refueling = legacy_location,
        log_date = legacy_log_date,
        log_time = btrim(legacy_log_time),
        price_per_gallon = legacy_price,
        total_price = legacy_total,
        currency_code = legacy_currency_code,
        comment = legacy_comment
      WHERE id = p_fuel_log_id;
    ELSE
      updated_log := public._update_fuel_log_with_tank_entries_legacy(
        p_fuel_log_id,
        p_vessel_id,
        p_log_patch - ARRAY['effective_at', 'utc_offset_minutes', 'expected_revision',
          'client_request_id', 'amendment_reason'],
        p_entries
      );
    END IF;
    UPDATE public.fuel_logs
    SET effective_at = COALESCE(
          NULLIF(p_log_patch ->> 'effective_at', '')::TIMESTAMPTZ,
          existing.effective_at
        ),
        utc_offset_minutes = COALESCE(
          NULLIF(p_log_patch ->> 'utc_offset_minutes', '')::SMALLINT,
          existing.utc_offset_minutes
        ),
        inventory_revision = existing.inventory_revision + 1
    WHERE id = p_fuel_log_id;
    SELECT to_jsonb(fuel_log) INTO updated_log
    FROM public.fuel_logs AS fuel_log WHERE id = p_fuel_log_id;
    legacy_after_snapshot := public._fuel_inventory_legacy_fuel_log_snapshot(
      p_fuel_log_id
    );

    INSERT INTO public.fuel_inventory_legacy_source_audits (
      vessel_id, source_type, source_id, action, before_snapshot,
      after_snapshot, reason, client_request_id, created_by, created_by_name
    ) VALUES (
      p_vessel_id, 'FUEL_LOG', p_fuel_log_id, 'AMENDMENT',
      legacy_before_snapshot, legacy_after_snapshot, amendment_reason,
      client_request_id, auth.uid(), actor_name
    );
    INSERT INTO public.fuel_inventory_request_results (
      vessel_id, client_request_id, request_kind, request_fingerprint,
      result_payload, created_by
    ) VALUES (
      p_vessel_id, client_request_id, 'LEGACY_REFUEL_AMEND',
      request_fingerprint, updated_log, auth.uid()
    );
    RETURN updated_log;
  END IF;

  SELECT * INTO old_operation FROM public.fuel_inventory_operations
  WHERE id = existing.current_inventory_operation_id;
  effective_at := COALESCE(
    (p_log_patch ->> 'effective_at')::TIMESTAMPTZ,
    old_operation.effective_at
  );
  utc_offset_minutes := CASE WHEN p_log_patch ? 'utc_offset_minutes'
    THEN (p_log_patch ->> 'utc_offset_minutes')::SMALLINT
    ELSE old_operation.utc_offset_minutes END;
  local_log_date := CASE WHEN p_log_patch ? 'log_date'
    THEN (p_log_patch ->> 'log_date')::DATE ELSE existing.log_date END;
  local_log_time := CASE WHEN p_log_patch ? 'log_time'
    THEN (p_log_patch ->> 'log_time')::TIME ELSE existing.log_time::TIME END;
  PERFORM public._validate_fuel_inventory_effective_time(
    effective_at, utc_offset_minutes, local_log_date, local_log_time
  );

  SELECT array_agg(DISTINCT tank_id ORDER BY tank_id) INTO affected_tanks
  FROM (
    SELECT fuel_tank_id AS tank_id FROM public.fuel_inventory_postings
    WHERE operation_id = old_operation.id
    UNION ALL
    SELECT fuel_tank_id FROM jsonb_to_recordset(p_entries)
      AS entry(fuel_tank_id UUID, amount_litres NUMERIC)
  ) AS ids;
  PERFORM public._lock_fuel_inventory_tanks(affected_tanks);
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_entries) AS entry(fuel_tank_id UUID, amount_litres NUMERIC)
    LEFT JOIN public.fuel_tanks AS tank ON tank.id = entry.fuel_tank_id
    WHERE tank.id IS NULL OR tank.vessel_id <> p_vessel_id
      OR (
        tank.archived_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.fuel_inventory_postings AS old_posting
          WHERE old_posting.operation_id = old_operation.id
            AND old_posting.fuel_tank_id = tank.id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Fuel log amendments may only use active tanks or retained source tanks';
  END IF;
  actor_name := public._fuel_inventory_actor_name();

  -- Persist and normalize the source row/allocation rows first.  Any later
  -- ledger validation error rolls the transaction back, while successful
  -- postings are built from these stored values rather than raw JSON.
  PERFORM set_config('nautical.fuel_inventory_rpc', 'on', TRUE);
  updated_log := public._update_fuel_log_with_tank_entries_legacy(
    p_fuel_log_id,
    p_vessel_id,
    p_log_patch - ARRAY['effective_at', 'utc_offset_minutes', 'expected_revision',
      'client_request_id', 'amendment_reason'],
    p_entries
  );

  INSERT INTO public.fuel_inventory_operations (
    id, vessel_id, logical_operation_id, revision_no, operation_type,
    effective_at, effective_order, utc_offset_minutes, source_fuel_log_id,
    supersedes_operation_id, metadata, client_request_id,
    request_fingerprint, created_by, created_by_name
  ) VALUES (
    replacement_id, p_vessel_id, old_operation.logical_operation_id,
    old_operation.revision_no + 1, 'REFUEL', effective_at,
    old_operation.effective_order, utc_offset_minutes, p_fuel_log_id,
    old_operation.id,
    (to_jsonb(existing) || p_log_patch)
      - ARRAY['current_inventory_operation_id', 'inventory_revision',
        'expected_revision', 'client_request_id'],
    client_request_id, request_fingerprint, auth.uid(), actor_name
  );
  INSERT INTO public.fuel_inventory_postings (
    operation_id, vessel_id, fuel_tank_id, posting_mode,
    amount_litres, tank_name_snapshot
  )
  SELECT replacement_id, p_vessel_id, tank.id, 'DELTA', entry.amount_litres, tank.name
  FROM public.fuel_log_tank_entries AS entry
  JOIN public.fuel_tanks AS tank ON tank.id = entry.fuel_tank_id
  WHERE entry.fuel_log_id = p_fuel_log_id;
  INSERT INTO public.fuel_inventory_voids (
    vessel_id, operation_id, void_kind, reason, client_request_id,
    request_fingerprint, created_by, created_by_name
  ) VALUES (
    p_vessel_id, old_operation.id, 'AMENDMENT', amendment_reason,
    client_request_id, request_fingerprint, auth.uid(), actor_name
  );

  PERFORM public._validate_fuel_inventory_operation(replacement_id);
  PERFORM public._validate_fuel_inventory_timelines(affected_tanks);
  UPDATE public.fuel_logs
  SET effective_at = (
        SELECT operation.effective_at
        FROM public.fuel_inventory_operations AS operation
        WHERE operation.id = replacement_id
      ),
      utc_offset_minutes = (
        SELECT operation.utc_offset_minutes
        FROM public.fuel_inventory_operations AS operation
        WHERE operation.id = replacement_id
      ),
      current_inventory_operation_id = replacement_id,
      inventory_revision = old_operation.revision_no + 1
  WHERE id = p_fuel_log_id;
  SELECT to_jsonb(fuel_log) INTO updated_log
  FROM public.fuel_logs AS fuel_log WHERE id = p_fuel_log_id;
  RETURN updated_log;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_fuel_log(
  p_fuel_log_id UUID,
  p_expected_revision INTEGER,
  p_reason TEXT,
  p_client_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing public.fuel_logs%ROWTYPE;
  affected_tanks UUID[];
  actor_name TEXT;
  request_payload JSONB;
  request_fingerprint TEXT;
  legacy_request_result JSONB;
  duplicate_operation_id UUID;
  legacy_before_snapshot JSONB;
  legacy_after_snapshot JSONB;
BEGIN
  IF COALESCE(btrim(p_reason), '') = '' OR char_length(p_reason) > 2000 THEN
    RAISE EXCEPTION 'A concise void reason is required';
  END IF;
  SELECT * INTO existing FROM public.fuel_logs
  WHERE id = p_fuel_log_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fuel log was not found'; END IF;
  IF NOT public.current_user_can_access_vessel(existing.vessel_id) THEN
    RAISE EXCEPTION 'Only active vessel members can void fuel logs';
  END IF;
  IF NOT public.current_user_can_manage_vessel(existing.vessel_id) THEN
    RAISE EXCEPTION 'Only an HOD or Captain/MOV can void fuel logs';
  END IF;

  request_payload := jsonb_build_object(
    'rpc', 'void_fuel_log', 'fuel_log_id', p_fuel_log_id,
    'expected_revision', p_expected_revision, 'reason', btrim(p_reason)
  );
  request_fingerprint := public._fuel_inventory_request_fingerprint(request_payload);
  legacy_request_result := public._fuel_inventory_existing_request_result(
    existing.vessel_id, p_client_request_id, 'LEGACY_REFUEL_VOID',
    request_fingerprint
  );
  IF legacy_request_result IS NOT NULL THEN
    RETURN legacy_request_result;
  END IF;
  duplicate_operation_id := public._fuel_inventory_existing_request(
    existing.vessel_id, p_client_request_id, request_fingerprint
  );
  IF duplicate_operation_id IS NOT NULL THEN
    RETURN to_jsonb(existing);
  END IF;

  PERFORM public._lock_fuel_inventory_vessel(existing.vessel_id);
  IF existing.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Fuel log is already voided'; END IF;
  IF existing.inventory_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Fuel log changed since it was loaded; refresh and try again';
  END IF;

  IF existing.current_inventory_operation_id IS NULL THEN
    actor_name := public._fuel_inventory_actor_name();
    legacy_before_snapshot := public._fuel_inventory_legacy_fuel_log_snapshot(
      p_fuel_log_id
    );
    UPDATE public.fuel_logs SET
      voided_at = now(), voided_by = auth.uid(), voided_by_name = actor_name
    WHERE id = p_fuel_log_id
    RETURNING * INTO existing;
    legacy_after_snapshot := public._fuel_inventory_legacy_fuel_log_snapshot(
      p_fuel_log_id
    );
    INSERT INTO public.fuel_inventory_legacy_source_audits (
      vessel_id, source_type, source_id, action, before_snapshot,
      after_snapshot, reason, client_request_id, created_by, created_by_name
    ) VALUES (
      existing.vessel_id, 'FUEL_LOG', p_fuel_log_id, 'VOID',
      legacy_before_snapshot, legacy_after_snapshot, btrim(p_reason),
      p_client_request_id, auth.uid(), actor_name
    );
    INSERT INTO public.fuel_inventory_request_results (
      vessel_id, client_request_id, request_kind, request_fingerprint,
      result_payload, created_by
    ) VALUES (
      existing.vessel_id, p_client_request_id, 'LEGACY_REFUEL_VOID',
      request_fingerprint, to_jsonb(existing), auth.uid()
    );
    RETURN to_jsonb(existing);
  END IF;

  SELECT array_agg(fuel_tank_id ORDER BY fuel_tank_id) INTO affected_tanks
  FROM public.fuel_inventory_postings
  WHERE operation_id = existing.current_inventory_operation_id;
  PERFORM public._lock_fuel_inventory_tanks(affected_tanks);
  actor_name := public._fuel_inventory_actor_name();
  INSERT INTO public.fuel_inventory_voids (
    vessel_id, operation_id, void_kind, reason, client_request_id,
    request_fingerprint, created_by, created_by_name
  ) VALUES (
    existing.vessel_id, existing.current_inventory_operation_id, 'ERROR',
    btrim(p_reason), p_client_request_id, request_fingerprint,
    auth.uid(), actor_name
  );
  PERFORM public._validate_fuel_inventory_timelines(affected_tanks);
  PERFORM set_config('nautical.fuel_inventory_rpc', 'on', TRUE);
  UPDATE public.fuel_logs SET
    voided_at = now(), voided_by = auth.uid(), voided_by_name = actor_name
  WHERE id = p_fuel_log_id
  RETURNING * INTO existing;
  RETURN to_jsonb(existing);
END;
$$;

REVOKE ALL ON FUNCTION public.create_fuel_log_with_tank_entries(JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_fuel_log_with_tank_entries(UUID, UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_fuel_log(UUID, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_fuel_log_with_tank_entries(JSONB, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_fuel_log_with_tank_entries(UUID, UUID, JSONB, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_fuel_log(UUID, INTEGER, TEXT, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.amend_fuel_inventory_entry(
  p_operation_id UUID,
  p_expected_revision INTEGER,
  p_effective_at TIMESTAMPTZ,
  p_utc_offset_minutes SMALLINT,
  p_amount_litres NUMERIC,
  p_location TEXT,
  p_entry_reason TEXT,
  p_notes TEXT,
  p_amendment_reason TEXT,
  p_client_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing public.fuel_inventory_operations%ROWTYPE;
  tank_id UUID;
  tank_name TEXT;
  posting_mode TEXT;
  posting_amount NUMERIC;
  replacement_id UUID := gen_random_uuid();
  actor_name TEXT;
  request_payload JSONB;
  request_fingerprint TEXT;
  duplicate_operation_id UUID;
BEGIN
  SELECT * INTO existing FROM public.fuel_inventory_operations
  WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND OR existing.operation_type NOT IN ('SOUNDING', 'CONSUMPTION', 'ADJUSTMENT') THEN
    RAISE EXCEPTION 'Only sounding, consumption, and adjustment entries use this amendment RPC';
  END IF;
  IF NOT public.current_user_can_manage_vessel(existing.vessel_id) THEN
    RAISE EXCEPTION 'Only an HOD or Captain/MOV can amend fuel inventory entries';
  END IF;
  IF p_amount_litres IS NULL THEN
    RAISE EXCEPTION 'Effective time and amount are required';
  END IF;
  PERFORM public._validate_fuel_inventory_effective_time(
    p_effective_at, p_utc_offset_minutes
  );
  IF existing.operation_type = 'SOUNDING' AND p_amount_litres < 0 THEN
    RAISE EXCEPTION 'Sounding level cannot be negative';
  ELSIF existing.operation_type = 'CONSUMPTION' AND p_amount_litres <= 0 THEN
    RAISE EXCEPTION 'Consumption must be greater than zero';
  ELSIF existing.operation_type = 'ADJUSTMENT' AND p_amount_litres = 0 THEN
    RAISE EXCEPTION 'Adjustment amount cannot be zero';
  END IF;
  IF existing.operation_type = 'ADJUSTMENT'
    AND COALESCE(btrim(p_entry_reason), '') = '' THEN
    RAISE EXCEPTION 'An adjustment reason is required';
  END IF;
  IF COALESCE(btrim(p_amendment_reason), '') = ''
    OR char_length(p_amendment_reason) > 2000
    OR char_length(COALESCE(p_entry_reason, '')) > 2000
    OR char_length(COALESCE(p_location, '')) > 240
    OR char_length(COALESCE(p_notes, '')) > 2000 THEN
    RAISE EXCEPTION 'A concise amendment reason and valid text fields are required';
  END IF;

  request_payload := jsonb_build_object(
    'rpc', 'amend_fuel_inventory_entry', 'operation_id', p_operation_id,
    'expected_revision', p_expected_revision, 'effective_at', p_effective_at,
    'utc_offset_minutes', p_utc_offset_minutes, 'amount_litres', p_amount_litres,
    'location', COALESCE(btrim(p_location), ''),
    'entry_reason', COALESCE(btrim(p_entry_reason), ''),
    'notes', COALESCE(btrim(p_notes), ''),
    'amendment_reason', btrim(p_amendment_reason)
  );
  request_fingerprint := public._fuel_inventory_request_fingerprint(request_payload);
  duplicate_operation_id := public._fuel_inventory_existing_request(
    existing.vessel_id, p_client_request_id, request_fingerprint
  );
  IF duplicate_operation_id IS NOT NULL THEN
    RETURN public._fuel_inventory_operation_json(duplicate_operation_id);
  END IF;

  IF existing.revision_no IS DISTINCT FROM p_expected_revision OR EXISTS (
    SELECT 1 FROM public.fuel_inventory_voids WHERE operation_id = existing.id
  ) THEN
    RAISE EXCEPTION 'Fuel inventory entry changed since it was loaded; refresh and try again';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.fuel_inventory_operations AS later
    WHERE later.logical_operation_id = existing.logical_operation_id
      AND later.revision_no > existing.revision_no
      AND NOT EXISTS (
        SELECT 1 FROM public.fuel_inventory_voids AS voided
        WHERE voided.operation_id = later.id
      )
  ) THEN
    RAISE EXCEPTION 'Fuel inventory entry is not the current revision';
  END IF;

  SELECT posting.fuel_tank_id, tank.name INTO tank_id, tank_name
  FROM public.fuel_inventory_postings AS posting
  JOIN public.fuel_tanks AS tank ON tank.id = posting.fuel_tank_id
  WHERE posting.operation_id = existing.id;
  IF tank_id IS NULL THEN RAISE EXCEPTION 'Fuel inventory entry has no tank posting'; END IF;
  posting_mode := CASE WHEN existing.operation_type = 'SOUNDING'
    THEN 'ABSOLUTE' ELSE 'DELTA' END;
  posting_amount := CASE WHEN existing.operation_type = 'CONSUMPTION'
    THEN -p_amount_litres ELSE p_amount_litres END;

  PERFORM public._lock_fuel_inventory_vessel(existing.vessel_id);
  PERFORM public._lock_fuel_inventory_tanks(ARRAY[tank_id]);
  actor_name := public._fuel_inventory_actor_name();
  INSERT INTO public.fuel_inventory_operations (
    id, vessel_id, logical_operation_id, revision_no, operation_type,
    effective_at, effective_order, utc_offset_minutes,
    supersedes_operation_id, metadata, client_request_id,
    request_fingerprint, created_by, created_by_name
  ) VALUES (
    replacement_id, existing.vessel_id, existing.logical_operation_id,
    existing.revision_no + 1, existing.operation_type, p_effective_at,
    existing.effective_order, p_utc_offset_minutes, existing.id,
    jsonb_build_object(
      'location', COALESCE(btrim(p_location), ''),
      'reason', COALESCE(btrim(p_entry_reason), ''),
      'notes', COALESCE(btrim(p_notes), ''),
      'amendment_reason', btrim(p_amendment_reason)
    ),
    p_client_request_id, request_fingerprint, auth.uid(), actor_name
  );
  INSERT INTO public.fuel_inventory_postings (
    operation_id, vessel_id, fuel_tank_id, posting_mode,
    amount_litres, tank_name_snapshot
  ) VALUES (
    replacement_id, existing.vessel_id, tank_id, posting_mode,
    posting_amount, tank_name
  );
  INSERT INTO public.fuel_inventory_voids (
    vessel_id, operation_id, void_kind, reason, client_request_id,
    request_fingerprint, created_by, created_by_name
  ) VALUES (
    existing.vessel_id, existing.id, 'AMENDMENT', btrim(p_amendment_reason),
    p_client_request_id, request_fingerprint, auth.uid(), actor_name
  );
  PERFORM public._validate_fuel_inventory_operation(replacement_id);
  PERFORM public._validate_fuel_inventory_timelines(ARRAY[tank_id]);
  RETURN public._fuel_inventory_operation_json(replacement_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_fuel_inventory_entry(
  p_operation_id UUID,
  p_expected_revision INTEGER,
  p_reason TEXT,
  p_client_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing public.fuel_inventory_operations%ROWTYPE;
  tank_ids UUID[];
  actor_name TEXT;
  request_payload JSONB;
  request_fingerprint TEXT;
  duplicate_operation_id UUID;
BEGIN
  SELECT * INTO existing FROM public.fuel_inventory_operations
  WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND OR existing.operation_type NOT IN ('SOUNDING', 'CONSUMPTION', 'ADJUSTMENT') THEN
    RAISE EXCEPTION 'Only sounding, consumption, and adjustment entries use this void RPC';
  END IF;
  IF NOT public.current_user_can_manage_vessel(existing.vessel_id) THEN
    RAISE EXCEPTION 'Only an HOD or Captain/MOV can void fuel inventory entries';
  END IF;
  request_payload := jsonb_build_object(
    'rpc', 'void_fuel_inventory_entry', 'operation_id', p_operation_id,
    'expected_revision', p_expected_revision, 'reason', btrim(p_reason)
  );
  request_fingerprint := public._fuel_inventory_request_fingerprint(request_payload);
  duplicate_operation_id := public._fuel_inventory_existing_request(
    existing.vessel_id, p_client_request_id, request_fingerprint
  );
  IF duplicate_operation_id IS NOT NULL THEN
    RETURN public._fuel_inventory_operation_json(p_operation_id);
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' OR char_length(p_reason) > 2000 THEN
    RAISE EXCEPTION 'A concise void reason is required';
  END IF;
  PERFORM public._lock_fuel_inventory_vessel(existing.vessel_id);
  IF existing.revision_no IS DISTINCT FROM p_expected_revision OR EXISTS (
    SELECT 1 FROM public.fuel_inventory_voids WHERE operation_id = existing.id
  ) OR EXISTS (
    SELECT 1 FROM public.fuel_inventory_operations AS later
    WHERE later.logical_operation_id = existing.logical_operation_id
      AND later.revision_no > existing.revision_no
      AND NOT EXISTS (
        SELECT 1 FROM public.fuel_inventory_voids AS voided
        WHERE voided.operation_id = later.id
      )
  ) THEN
    RAISE EXCEPTION 'Fuel inventory entry changed since it was loaded; refresh and try again';
  END IF;
  SELECT array_agg(fuel_tank_id ORDER BY fuel_tank_id) INTO tank_ids
  FROM public.fuel_inventory_postings WHERE operation_id = existing.id;
  PERFORM public._lock_fuel_inventory_tanks(tank_ids);
  actor_name := public._fuel_inventory_actor_name();
  INSERT INTO public.fuel_inventory_voids (
    vessel_id, operation_id, void_kind, reason, client_request_id,
    request_fingerprint, created_by, created_by_name
  ) VALUES (
    existing.vessel_id, existing.id, 'ERROR', btrim(p_reason),
    p_client_request_id, request_fingerprint, auth.uid(), actor_name
  );
  PERFORM public._validate_fuel_inventory_timelines(tank_ids);
  RETURN public._fuel_inventory_operation_json(existing.id);
END;
$$;

REVOKE ALL ON FUNCTION public.amend_fuel_inventory_entry(
  UUID, INTEGER, TIMESTAMPTZ, SMALLINT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_fuel_inventory_entry(UUID, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amend_fuel_inventory_entry(
  UUID, INTEGER, TIMESTAMPTZ, SMALLINT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_fuel_inventory_entry(UUID, INTEGER, TEXT, UUID)
  TO authenticated;


-- Archived tanks retain their immutable ledger history, while names only need
-- to be unique among tanks that can currently be selected.
DROP INDEX IF EXISTS public.fuel_tanks_vessel_normalized_name_key;
CREATE UNIQUE INDEX fuel_tanks_vessel_normalized_name_key
  ON public.fuel_tanks (vessel_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION public._fuel_inventory_tank_balance_at(
  p_fuel_tank_id UUID,
  p_as_of TIMESTAMPTZ
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  posting_row RECORD;
  running_balance NUMERIC;
BEGIN
  FOR posting_row IN
    SELECT posting.posting_mode, posting.amount_litres
    FROM public.fuel_inventory_postings AS posting
    JOIN public.fuel_inventory_operations AS operation
      ON operation.id = posting.operation_id
    WHERE posting.fuel_tank_id = p_fuel_tank_id
      AND operation.effective_at <= p_as_of
      AND NOT EXISTS (
        SELECT 1 FROM public.fuel_inventory_voids AS voided
        WHERE voided.operation_id = operation.id
      )
    ORDER BY operation.effective_at, operation.effective_order, operation.recorded_sequence
  LOOP
    IF posting_row.posting_mode = 'ABSOLUTE' THEN
      running_balance := posting_row.amount_litres;
    ELSIF running_balance IS NOT NULL THEN
      running_balance := running_balance + posting_row.amount_litres;
    END IF;
  END LOOP;
  RETURN running_balance;
END;
$$;
REVOKE ALL ON FUNCTION public._fuel_inventory_tank_balance_at(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.save_vessel_fuel_setup(UUID, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.save_vessel_fuel_setup(
  p_vessel_id UUID,
  p_volume_unit TEXT,
  p_tanks JSONB,
  p_expected_revision INTEGER,
  p_client_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  saved_setup JSONB;
  existing_request_result JSONB;
  existing_operation_id UUID;
  request_payload JSONB;
  request_fingerprint TEXT;
  current_revision INTEGER;
  omitted RECORD;
  omitted_balance NUMERIC;
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
  IF p_expected_revision IS NULL OR p_expected_revision < 0
    OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'Fuel setup requires a non-negative expected revision and client request ID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_tanks) AS input(
      id UUID, name TEXT, location TEXT, description TEXT, capacity_litres NUMERIC
    )
    WHERE name IS NULL OR char_length(btrim(name)) NOT BETWEEN 1 AND 120
      OR COALESCE(char_length(location), 0) > 240
      OR COALESCE(char_length(description), 0) > 2000
      OR capacity_litres IS NULL OR capacity_litres <= 0
  ) THEN
    RAISE EXCEPTION 'Every fuel tank requires a name and positive capacity';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT id FROM jsonb_to_recordset(p_tanks) AS input(
        id UUID, name TEXT, location TEXT, description TEXT, capacity_litres NUMERIC
      ) WHERE id IS NOT NULL GROUP BY id HAVING count(*) > 1
    ) AS duplicate_ids
  ) THEN RAISE EXCEPTION 'Fuel setup contains duplicate tank IDs'; END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT lower(btrim(name)) AS normalized_name
      FROM jsonb_to_recordset(p_tanks) AS input(
        id UUID, name TEXT, location TEXT, description TEXT, capacity_litres NUMERIC
      ) GROUP BY lower(btrim(name)) HAVING count(*) > 1
    ) AS duplicate_names
  ) THEN RAISE EXCEPTION 'Fuel setup contains duplicate tank names'; END IF;

  request_payload := jsonb_build_object(
    'rpc', 'save_vessel_fuel_setup',
    'vessel_id', p_vessel_id,
    'volume_unit', p_volume_unit,
    'tanks', p_tanks,
    'expected_revision', p_expected_revision
  );
  request_fingerprint := public._fuel_inventory_request_fingerprint(request_payload);
  existing_request_result := public._fuel_inventory_existing_request_result(
    p_vessel_id, p_client_request_id, 'FUEL_SETUP_SAVE', request_fingerprint
  );
  IF existing_request_result IS NOT NULL THEN
    RETURN existing_request_result;
  END IF;
  existing_operation_id := public._fuel_inventory_existing_request(
    p_vessel_id, p_client_request_id, request_fingerprint
  );
  IF existing_operation_id IS NOT NULL THEN
    RAISE EXCEPTION 'Client request ID was already used by another fuel action';
  END IF;

  -- Serialize the complete read/validate/write cycle before consulting mutable
  -- setup or tank state.  The expected revision rejects stale editors after
  -- the lock is acquired; exact retries returned above bypass that stale check.
  PERFORM public._lock_fuel_inventory_vessel(p_vessel_id);
  SELECT settings.setup_revision INTO current_revision
  FROM public.vessel_fuel_settings AS settings
  WHERE settings.vessel_id = p_vessel_id;
  current_revision := COALESCE(current_revision, 0);
  IF current_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Fuel setup changed since it was loaded; refresh and try again';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_tanks) AS input(
      id UUID, name TEXT, location TEXT, description TEXT, capacity_litres NUMERIC
    )
    LEFT JOIN public.fuel_tanks AS existing
      ON existing.id = input.id AND existing.vessel_id = p_vessel_id
    WHERE input.id IS NOT NULL AND existing.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Fuel setup contains a tank that does not belong to this vessel';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_tanks) AS input(
      id UUID, name TEXT, location TEXT, description TEXT, capacity_litres NUMERIC
    )
    JOIN public.fuel_tanks AS existing
      ON existing.id = input.id AND existing.vessel_id = p_vessel_id
    WHERE existing.archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Archived fuel tank IDs cannot be restored; add a new tank instead';
  END IF;

  -- Lock existing tanks before deciding whether omissions can be deleted or
  -- must be retained as archived audit entities.
  PERFORM public._lock_fuel_inventory_tanks(ARRAY(
    SELECT id FROM public.fuel_tanks WHERE vessel_id = p_vessel_id ORDER BY id
  ));

  FOR omitted IN
    SELECT existing.id
    FROM public.fuel_tanks AS existing
    WHERE existing.vessel_id = p_vessel_id
      AND existing.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_to_recordset(p_tanks) AS input(
          id UUID, name TEXT, location TEXT, description TEXT, capacity_litres NUMERIC
        ) WHERE input.id = existing.id
      )
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.fuel_inventory_postings WHERE fuel_tank_id = omitted.id
    ) OR EXISTS (
      SELECT 1 FROM public.fuel_log_tank_entries WHERE fuel_tank_id = omitted.id
    ) OR EXISTS (
      SELECT 1 FROM public.fuel_transfers
      WHERE source_tank_id = omitted.id OR destination_tank_id = omitted.id
    ) THEN
      omitted_balance := public._fuel_inventory_tank_balance_at(
        omitted.id, clock_timestamp()
      );
      IF COALESCE(omitted_balance, 0) <> 0 THEN
        RAISE EXCEPTION 'A fuel tank must have a zero current balance before it can be archived';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM public.fuel_inventory_postings AS posting
        JOIN public.fuel_inventory_operations AS operation
          ON operation.id = posting.operation_id
        WHERE posting.fuel_tank_id = omitted.id
          AND operation.effective_at > clock_timestamp()
          AND NOT EXISTS (
            SELECT 1 FROM public.fuel_inventory_voids AS voided
            WHERE voided.operation_id = operation.id
          )
      ) THEN
        RAISE EXCEPTION 'A fuel tank with future inventory activity cannot be archived';
      END IF;
      UPDATE public.fuel_tanks SET archived_at = clock_timestamp() WHERE id = omitted.id;
    ELSE
      DELETE FROM public.fuel_tanks WHERE id = omitted.id;
    END IF;
  END LOOP;

  -- Temporary unique names permit swaps and rotations under the immediate
  -- partial unique index. Archived IDs are never restored because doing so
  -- would erase the historical inactive interval; a re-added tank gets a new ID.
  UPDATE public.fuel_tanks AS existing
  SET name = '__fuel_setup_tmp__' || gen_random_uuid()::TEXT,
      archived_at = NULL
  WHERE existing.vessel_id = p_vessel_id
    AND existing.archived_at IS NULL
    AND EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_tanks) AS input(
        id UUID, name TEXT, location TEXT, description TEXT, capacity_litres NUMERIC
      ) WHERE input.id = existing.id
    );

  UPDATE public.fuel_tanks AS existing SET
    name = btrim(input.name),
    location = COALESCE(btrim(input.location), ''),
    description = COALESCE(btrim(input.description), ''),
    capacity_litres = input.capacity_litres,
    archived_at = NULL
  FROM jsonb_to_recordset(p_tanks) AS input(
    id UUID, name TEXT, location TEXT, description TEXT, capacity_litres NUMERIC
  )
  WHERE input.id IS NOT NULL AND existing.id = input.id
    AND existing.vessel_id = p_vessel_id
    AND existing.archived_at IS NULL;

  INSERT INTO public.fuel_tanks (
    vessel_id, name, location, description, capacity_litres
  )
  SELECT p_vessel_id, btrim(input.name), COALESCE(btrim(input.location), ''),
    COALESCE(btrim(input.description), ''), input.capacity_litres
  FROM jsonb_to_recordset(p_tanks) AS input(
    id UUID, name TEXT, location TEXT, description TEXT, capacity_litres NUMERIC
  ) WHERE input.id IS NULL;

  -- Re-run the complete chronological invariant after all archive/unarchive
  -- and capacity changes.  This validates historical peaks, not merely the
  -- current aggregate balance.
  PERFORM public._validate_fuel_inventory_timelines(ARRAY(
    SELECT id FROM public.fuel_tanks WHERE vessel_id = p_vessel_id ORDER BY id
  ));

  INSERT INTO public.vessel_fuel_settings (
    vessel_id, volume_unit, setup_revision
  ) VALUES (
    p_vessel_id, p_volume_unit, current_revision + 1
  )
  ON CONFLICT (vessel_id) DO UPDATE SET
    volume_unit = EXCLUDED.volume_unit,
    setup_revision = EXCLUDED.setup_revision;

  SELECT jsonb_build_object(
    'settings', (
      SELECT to_jsonb(settings) FROM public.vessel_fuel_settings AS settings
      WHERE settings.vessel_id = p_vessel_id
    ),
    'tanks', COALESCE((
      SELECT jsonb_agg(to_jsonb(tank) ORDER BY lower(tank.name), tank.id)
      FROM public.fuel_tanks AS tank
      WHERE tank.vessel_id = p_vessel_id AND tank.archived_at IS NULL
    ), '[]'::JSONB)
  ) INTO saved_setup;

  INSERT INTO public.fuel_inventory_request_results (
    vessel_id, client_request_id, request_kind, request_fingerprint,
    result_payload, created_by
  ) VALUES (
    p_vessel_id, p_client_request_id, 'FUEL_SETUP_SAVE', request_fingerprint,
    saved_setup, auth.uid()
  );

  RETURN saved_setup;
END;
$$;

REVOKE ALL ON FUNCTION public.save_vessel_fuel_setup(UUID, TEXT, JSONB, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_vessel_fuel_setup(UUID, TEXT, JSONB, INTEGER, UUID)
  TO authenticated;

-- DB-first rollout adapter for the installed foundation client. It deliberately
-- has no post-activation behavior: once a vessel opts into the append-only
-- inventory ledger, setup changes require the revision-aware five-argument RPC.
-- Reading the revision under the shared vessel lock preserves the old client's
-- last-writer-wins semantics without allowing it to race the activation cutover.
CREATE OR REPLACE FUNCTION public.save_vessel_fuel_setup(
  p_vessel_id UUID,
  p_volume_unit TEXT,
  p_tanks JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_revision INTEGER;
  inventory_active BOOLEAN;
BEGIN
  IF p_vessel_id IS NULL OR NOT public.current_user_can_manage_vessel(p_vessel_id) THEN
    RAISE EXCEPTION 'Only an HOD or Captain/MOV can save vessel fuel setup';
  END IF;

  PERFORM public._lock_fuel_inventory_vessel(p_vessel_id);
  SELECT
    settings.setup_revision,
    settings.inventory_activated_at IS NOT NULL
  INTO current_revision, inventory_active
  FROM public.vessel_fuel_settings AS settings
  WHERE settings.vessel_id = p_vessel_id;

  IF COALESCE(inventory_active, FALSE) THEN
    RAISE EXCEPTION 'Activated fuel inventory setup requires the current app version';
  END IF;

  RETURN public.save_vessel_fuel_setup(
    p_vessel_id,
    p_volume_unit,
    p_tanks,
    COALESCE(current_revision, 0),
    gen_random_uuid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_vessel_fuel_setup(UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_vessel_fuel_setup(UUID, TEXT, JSONB)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_vessel_fuel_setup(p_vessel_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result JSONB;
BEGIN
  IF p_vessel_id IS NULL OR NOT public.current_user_can_access_vessel(p_vessel_id) THEN
    RAISE EXCEPTION 'You do not have access to this vessel';
  END IF;

  -- Settings and tanks are read by one statement/snapshot so callers cannot
  -- combine a setup revision from one save with a tank list from another.
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
        AND tank.archived_at IS NULL
    ), '[]'::JSONB)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_vessel_fuel_setup(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vessel_fuel_setup(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_fuel_log_allocation_snapshot(
  p_vessel_id UUID,
  p_fuel_log_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requested_ids UUID[];
  result JSONB;
BEGIN
  IF p_vessel_id IS NULL OR NOT public.current_user_can_access_vessel(p_vessel_id) THEN
    RAISE EXCEPTION 'You do not have access to this vessel';
  END IF;
  IF p_fuel_log_ids IS NULL OR cardinality(p_fuel_log_ids) = 0 THEN
    RETURN jsonb_build_object('vessel_id', p_vessel_id, 'allocations', '[]'::JSONB);
  END IF;
  IF cardinality(p_fuel_log_ids) > 100
    OR array_position(p_fuel_log_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Between 1 and 100 fuel log IDs are required';
  END IF;

  SELECT array_agg(DISTINCT requested_id ORDER BY requested_id)
  INTO requested_ids
  FROM unnest(p_fuel_log_ids) AS requested(requested_id);

  IF EXISTS (
    SELECT 1
    FROM unnest(requested_ids) AS requested(requested_id)
    LEFT JOIN public.fuel_logs AS fuel_log ON fuel_log.id = requested.requested_id
    WHERE fuel_log.id IS NULL OR fuel_log.vessel_id <> p_vessel_id
  ) THEN
    RAISE EXCEPTION 'A requested fuel log does not belong to this vessel';
  END IF;

  -- An activated receipt uses the immutable name captured by its current
  -- ledger revision.  A pre-activation receipt falls back to its retained
  -- allocation row and the tank's current catalogue name.
  WITH allocations AS (
    SELECT
      fuel_log.id AS fuel_log_id,
      operation.id AS operation_id,
      fuel_log.inventory_revision,
      posting.fuel_tank_id,
      posting.tank_name_snapshot AS tank_name,
      posting.amount_litres,
      'LEDGER'::TEXT AS source
    FROM public.fuel_logs AS fuel_log
    JOIN public.fuel_inventory_operations AS operation
      ON operation.id = fuel_log.current_inventory_operation_id
    JOIN public.fuel_inventory_postings AS posting
      ON posting.operation_id = operation.id
    WHERE fuel_log.vessel_id = p_vessel_id
      AND fuel_log.id = ANY(requested_ids)
      AND fuel_log.voided_at IS NULL

    UNION ALL

    SELECT
      fuel_log.id,
      NULL::UUID,
      fuel_log.inventory_revision,
      entry.fuel_tank_id,
      tank.name,
      entry.amount_litres,
      'LEGACY'::TEXT
    FROM public.fuel_logs AS fuel_log
    JOIN public.fuel_log_tank_entries AS entry
      ON entry.fuel_log_id = fuel_log.id
    JOIN public.fuel_tanks AS tank ON tank.id = entry.fuel_tank_id
    WHERE fuel_log.vessel_id = p_vessel_id
      AND fuel_log.id = ANY(requested_ids)
      AND fuel_log.current_inventory_operation_id IS NULL
      AND fuel_log.voided_at IS NULL
  )
  SELECT jsonb_build_object(
    'vessel_id', p_vessel_id,
    'allocations', COALESCE(jsonb_agg(jsonb_build_object(
      'fuel_log_id', allocation.fuel_log_id,
      'operation_id', allocation.operation_id,
      'inventory_revision', allocation.inventory_revision,
      'fuel_tank_id', allocation.fuel_tank_id,
      'tank_name', allocation.tank_name,
      'amount_litres', allocation.amount_litres,
      'source', allocation.source
    ) ORDER BY allocation.fuel_log_id, lower(allocation.tank_name), allocation.fuel_tank_id), '[]'::JSONB)
  ) INTO result
  FROM allocations AS allocation;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_fuel_log_allocation_snapshot(UUID, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_fuel_log_allocation_snapshot(UUID, UUID[])
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_fuel_transfers_with_snapshots(
  p_vessel_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result JSONB;
BEGIN
  IF p_vessel_id IS NULL OR NOT public.current_user_can_access_vessel(p_vessel_id) THEN
    RAISE EXCEPTION 'You do not have access to this vessel';
  END IF;

  SELECT jsonb_build_object(
    'vessel_id', p_vessel_id,
    'transfers', COALESCE(jsonb_agg(
      to_jsonb(transfer_row.transfer_record) || jsonb_build_object(
        'operation_id', transfer_row.operation_id,
        'effective_at', transfer_row.effective_at,
        'utc_offset_minutes', transfer_row.utc_offset_minutes,
        'source_tank_name', transfer_row.source_tank_name,
        'destination_tank_name', transfer_row.destination_tank_name,
        'snapshot_source', transfer_row.snapshot_source
      )
      ORDER BY transfer_row.transfer_date DESC,
        transfer_row.transfer_time DESC,
        transfer_row.created_at DESC,
        transfer_row.id DESC
    ), '[]'::JSONB)
  ) INTO result
  FROM (
    SELECT
      transfer AS transfer_record,
      transfer.id,
      transfer.transfer_date,
      transfer.transfer_time,
      transfer.created_at,
      operation.id AS operation_id,
      COALESCE(operation.effective_at, transfer.effective_at) AS effective_at,
      COALESCE(operation.utc_offset_minutes, transfer.utc_offset_minutes)
        AS utc_offset_minutes,
      COALESCE(source_posting.tank_name_snapshot, source_tank.name)
        AS source_tank_name,
      COALESCE(destination_posting.tank_name_snapshot, destination_tank.name)
        AS destination_tank_name,
      CASE WHEN operation.id IS NULL THEN 'LEGACY' ELSE 'LEDGER' END
        AS snapshot_source
    FROM public.fuel_transfers AS transfer
    LEFT JOIN public.fuel_inventory_operations AS operation
      ON operation.id = transfer.current_inventory_operation_id
    LEFT JOIN public.fuel_inventory_postings AS source_posting
      ON source_posting.operation_id = operation.id
      AND source_posting.fuel_tank_id = transfer.source_tank_id
      AND source_posting.amount_litres < 0
    LEFT JOIN public.fuel_inventory_postings AS destination_posting
      ON destination_posting.operation_id = operation.id
      AND destination_posting.fuel_tank_id = transfer.destination_tank_id
      AND destination_posting.amount_litres > 0
    LEFT JOIN public.fuel_tanks AS source_tank
      ON source_tank.id = transfer.source_tank_id
    LEFT JOIN public.fuel_tanks AS destination_tank
      ON destination_tank.id = transfer.destination_tank_id
    WHERE transfer.vessel_id = p_vessel_id
      AND transfer.voided_at IS NULL
  ) AS transfer_row;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_fuel_transfers_with_snapshots(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_fuel_transfers_with_snapshots(UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_fuel_inventory_legacy_audits(
  p_vessel_id UUID,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_before_recorded_at TIMESTAMPTZ DEFAULT NULL,
  p_before_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_source_type TEXT := CASE
    WHEN p_source_type IS NULL THEN NULL
    ELSE upper(btrim(p_source_type))
  END;
  result JSONB;
BEGIN
  IF p_vessel_id IS NULL OR NOT public.current_user_can_access_vessel(p_vessel_id) THEN
    RAISE EXCEPTION 'You do not have access to this vessel';
  END IF;
  IF normalized_source_type IS NOT NULL
    AND normalized_source_type NOT IN ('FUEL_LOG', 'FUEL_TRANSFER') THEN
    RAISE EXCEPTION 'Legacy audit source type must be FUEL_LOG or FUEL_TRANSFER';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Legacy audit page limit must be between 1 and 100';
  END IF;
  IF (p_before_recorded_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'Legacy audit cursor requires both recorded_at and id';
  END IF;

  WITH matching AS MATERIALIZED (
    SELECT audit.*
    FROM public.fuel_inventory_legacy_source_audits AS audit
    WHERE audit.vessel_id = p_vessel_id
      AND (normalized_source_type IS NULL
        OR audit.source_type = normalized_source_type)
      AND (p_source_id IS NULL OR audit.source_id = p_source_id)
      AND (p_before_recorded_at IS NULL
        OR (audit.recorded_at, audit.id) < (p_before_recorded_at, p_before_id))
    ORDER BY audit.recorded_at DESC, audit.id DESC
    LIMIT p_limit + 1
  ), page AS MATERIALIZED (
    SELECT *
    FROM matching
    ORDER BY recorded_at DESC, id DESC
    LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'vessel_id', p_vessel_id,
    'audits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', audit.id,
        'vessel_id', audit.vessel_id,
        'source_type', audit.source_type,
        'source_id', audit.source_id,
        'action', audit.action,
        'revision_before', audit.before_snapshot -> 'inventory_revision',
        'revision_after', audit.after_snapshot -> 'inventory_revision',
        'before_snapshot', audit.before_snapshot,
        'after_snapshot', audit.after_snapshot,
        'reason', audit.reason,
        'client_request_id', audit.client_request_id,
        'created_by', audit.created_by,
        'created_by_name', audit.created_by_name,
        'recorded_at', audit.recorded_at
      ) ORDER BY audit.recorded_at DESC, audit.id DESC)
      FROM page AS audit
    ), '[]'::JSONB),
    'next_cursor', CASE
      WHEN (SELECT count(*) FROM matching) > p_limit THEN (
        SELECT jsonb_build_object('recorded_at', audit.recorded_at, 'id', audit.id)
        FROM page AS audit
        ORDER BY audit.recorded_at ASC, audit.id ASC
        LIMIT 1
      )
      ELSE 'null'::JSONB
    END
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_fuel_inventory_legacy_audits(
  UUID, TEXT, UUID, INTEGER, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_fuel_inventory_legacy_audits(
  UUID, TEXT, UUID, INTEGER, TIMESTAMPTZ, UUID
) TO authenticated;

-- Before activation, source rows are report-only evidence: there is no honest
-- opening balance from which to derive a running quantity. Keep structural and
-- per-event physical checks here, but never reconstruct a pseudo-balance by
-- treating an unknown opening quantity as zero. Activated vessels are governed
-- by chronological ledger replay instead.
CREATE OR REPLACE FUNCTION public.validate_fuel_transfer_tanks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_tank_ids UUID[];
  affected_vessel_id UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.vessel_id ELSE NEW.vessel_id END;
  source_capacity_litres NUMERIC(14, 3);
  destination_capacity_litres NUMERIC(14, 3);
  source_created_at TIMESTAMPTZ;
  destination_created_at TIMESTAMPTZ;
  source_archived_at TIMESTAMPTZ;
  destination_archived_at TIMESTAMPTZ;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.vessel_fuel_settings
    WHERE vessel_id = affected_vessel_id AND inventory_activated_at IS NOT NULL
  ) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.vessels WHERE id = OLD.vessel_id) THEN RETURN OLD; END IF;
    affected_tank_ids := ARRAY[OLD.source_tank_id, OLD.destination_tank_id];
  ELSIF TG_OP = 'UPDATE' THEN
    affected_tank_ids := ARRAY[
      OLD.source_tank_id, OLD.destination_tank_id,
      NEW.source_tank_id, NEW.destination_tank_id
    ];
  ELSE
    affected_tank_ids := ARRAY[NEW.source_tank_id, NEW.destination_tank_id];
  END IF;

  PERFORM 1 FROM public.fuel_tanks WHERE id = ANY(affected_tank_ids)
    ORDER BY id FOR UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  SELECT tank.capacity_litres, tank.created_at, tank.archived_at
  INTO source_capacity_litres, source_created_at, source_archived_at
  FROM public.fuel_tanks AS tank
  WHERE tank.id = NEW.source_tank_id AND tank.vessel_id = NEW.vessel_id;
  SELECT tank.capacity_litres, tank.created_at, tank.archived_at
  INTO destination_capacity_litres, destination_created_at, destination_archived_at
  FROM public.fuel_tanks AS tank
  WHERE tank.id = NEW.destination_tank_id AND tank.vessel_id = NEW.vessel_id;
  IF source_capacity_litres IS NULL THEN
    RAISE EXCEPTION 'Source tank must belong to the transfer vessel';
  END IF;
  IF destination_capacity_litres IS NULL THEN
    RAISE EXCEPTION 'Destination tank must belong to the transfer vessel';
  END IF;
  IF NEW.effective_at IS NOT NULL
    AND (
      NEW.effective_at < date_trunc('minute', source_created_at)
      OR NEW.effective_at < date_trunc('minute', destination_created_at)
    ) THEN
    RAISE EXCEPTION 'Transfer tanks must exist at the ship time';
  END IF;
  IF source_archived_at IS NOT NULL THEN
    IF TG_OP <> 'UPDATE'
      OR (
        NEW.source_tank_id <> OLD.source_tank_id
        AND NEW.source_tank_id <> OLD.destination_tank_id
      )
      OR (
        NEW.effective_at IS NOT NULL
        AND NEW.effective_at >= source_archived_at
      ) THEN
      RAISE EXCEPTION 'New transfers may only use active tanks';
    END IF;
  END IF;
  IF destination_archived_at IS NOT NULL THEN
    IF TG_OP <> 'UPDATE'
      OR (
        NEW.destination_tank_id <> OLD.source_tank_id
        AND NEW.destination_tank_id <> OLD.destination_tank_id
      )
      OR (
        NEW.effective_at IS NOT NULL
        AND NEW.effective_at >= destination_archived_at
      ) THEN
      RAISE EXCEPTION 'New transfers may only use active tanks';
    END IF;
  END IF;
  IF NEW.voided_at IS NULL AND NEW.amount_litres > source_capacity_litres THEN
    RAISE EXCEPTION 'Transfer amount exceeds source tank capacity';
  END IF;
  IF NEW.voided_at IS NULL AND NEW.amount_litres > destination_capacity_litres THEN
    RAISE EXCEPTION 'Transfer amount exceeds destination tank capacity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_fuel_log_tank_entry_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_tank_ids UUID[];
  affected_vessel_id UUID;
  tank_capacity_litres NUMERIC(14, 3);
BEGIN
  IF TG_OP = 'INSERT' THEN
    affected_tank_ids := ARRAY[NEW.fuel_tank_id]; affected_vessel_id := NEW.vessel_id;
  ELSIF TG_OP = 'DELETE' THEN
    affected_tank_ids := ARRAY[OLD.fuel_tank_id]; affected_vessel_id := OLD.vessel_id;
  ELSE
    affected_tank_ids := ARRAY[OLD.fuel_tank_id, NEW.fuel_tank_id];
    affected_vessel_id := OLD.vessel_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.vessel_fuel_settings
    WHERE vessel_id = affected_vessel_id AND inventory_activated_at IS NOT NULL) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vessels WHERE id = affected_vessel_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  PERFORM 1 FROM public.fuel_tanks WHERE id = ANY(affected_tank_ids)
    ORDER BY id FOR UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF EXISTS (
    SELECT 1 FROM public.fuel_logs
    WHERE id = NEW.fuel_log_id AND voided_at IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  SELECT tank.capacity_litres INTO tank_capacity_litres
  FROM public.fuel_tanks AS tank
  WHERE tank.id = NEW.fuel_tank_id AND tank.vessel_id = NEW.vessel_id;
  IF tank_capacity_litres IS NULL THEN
    RAISE EXCEPTION 'Fuel log tank must belong to the receipt vessel';
  END IF;
  IF NEW.amount_litres > tank_capacity_litres THEN
    RAISE EXCEPTION 'Fuel log allocation exceeds tank capacity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_fuel_tank_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  posting_row RECORD;
  running_balance NUMERIC;
BEGIN
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN
    RAISE EXCEPTION 'Archived fuel tank IDs cannot be restored; add a new tank instead';
  END IF;

  -- Source reports do not establish a balance before activation, but each
  -- individual event must remain physically possible. This check also covers
  -- retained report-only rows after activation; it never sums unrelated
  -- receipts or transfers into a fabricated quantity on board.
  IF EXISTS (
    SELECT 1
    FROM public.fuel_log_tank_entries AS entry
    JOIN public.fuel_logs AS fuel_log ON fuel_log.id = entry.fuel_log_id
    WHERE entry.fuel_tank_id = OLD.id
      AND fuel_log.voided_at IS NULL
      AND entry.amount_litres > NEW.capacity_litres
  ) OR EXISTS (
    SELECT 1
    FROM public.fuel_transfers AS transfer
    WHERE (transfer.source_tank_id = OLD.id OR transfer.destination_tank_id = OLD.id)
      AND transfer.voided_at IS NULL
      AND transfer.amount_litres > NEW.capacity_litres
  ) THEN
    RAISE EXCEPTION 'Fuel tank capacity cannot be lower than a retained report event';
  END IF;

  -- Current clients may record a ship event a few minutes ahead for clock
  -- tolerance. Do not allow setup to archive the referenced tank before that
  -- known event occurs. NULL-time historical rows remain truthfully unknown.
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.fuel_log_tank_entries AS entry
        JOIN public.fuel_logs AS fuel_log ON fuel_log.id = entry.fuel_log_id
        WHERE entry.fuel_tank_id = OLD.id
          AND fuel_log.voided_at IS NULL
          AND fuel_log.effective_at IS NOT NULL
          AND fuel_log.effective_at >= NEW.archived_at
      )
      OR EXISTS (
        SELECT 1
        FROM public.fuel_transfers AS transfer
        WHERE (transfer.source_tank_id = OLD.id OR transfer.destination_tank_id = OLD.id)
          AND transfer.voided_at IS NULL
          AND transfer.effective_at IS NOT NULL
          AND transfer.effective_at >= NEW.archived_at
      )
    ) THEN
    RAISE EXCEPTION 'A fuel tank cannot be archived before a retained report event';
  END IF;

  IF EXISTS (SELECT 1 FROM public.vessel_fuel_settings
    WHERE vessel_id = OLD.vessel_id AND inventory_activated_at IS NOT NULL) THEN
    IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
      IF COALESCE(public._fuel_inventory_tank_balance_at(
        OLD.id, clock_timestamp()
      ), 0) <> 0 THEN
        RAISE EXCEPTION 'A fuel tank must have a zero current balance before it can be archived';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM public.fuel_inventory_postings AS posting
        JOIN public.fuel_inventory_operations AS operation
          ON operation.id = posting.operation_id
        WHERE posting.fuel_tank_id = OLD.id
          AND operation.effective_at > clock_timestamp()
          AND NOT EXISTS (
            SELECT 1 FROM public.fuel_inventory_voids AS voided
            WHERE voided.operation_id = operation.id
          )
      ) THEN
        RAISE EXCEPTION 'A fuel tank with future inventory activity cannot be archived';
      END IF;
    END IF;
    running_balance := NULL;
    FOR posting_row IN
      SELECT posting.posting_mode, posting.amount_litres
      FROM public.fuel_inventory_postings AS posting
      JOIN public.fuel_inventory_operations AS operation ON operation.id = posting.operation_id
      WHERE posting.fuel_tank_id = OLD.id
        AND NOT EXISTS (SELECT 1 FROM public.fuel_inventory_voids AS voided
          WHERE voided.operation_id = operation.id)
      ORDER BY operation.effective_at, operation.effective_order, operation.recorded_sequence
    LOOP
      IF posting_row.posting_mode = 'ABSOLUTE' THEN
        running_balance := posting_row.amount_litres;
      ELSE
        running_balance := running_balance + posting_row.amount_litres;
      END IF;
      IF running_balance > NEW.capacity_litres THEN
        RAISE EXCEPTION 'Fuel tank capacity cannot be lower than an active historical balance';
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  -- Prior to activation, receipts and transfers are report-only and cannot
  -- establish a current balance. Capacity edits therefore remain catalogue
  -- changes; the opening-level RPC performs the first truthful capacity check.
  RETURN NEW;
END;
$$;

-- Trigger functions are implementation details.  The production baseline's
-- default privileges explicitly granted function execution to API roles, so
-- revoking PUBLIC alone is not sufficient.
REVOKE ALL ON FUNCTION public.enforce_fuel_log_actor()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_fuel_setup_actor()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_fuel_transfer_actor()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_fuel_log_tank_entry_vessel()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_fuel_log_parent_state()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_fuel_transfer_tanks()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_fuel_log_tank_entry_balance()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_fuel_tank_capacity()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS validate_fuel_tank_capacity ON public.fuel_tanks;
CREATE TRIGGER validate_fuel_tank_capacity
  BEFORE UPDATE OF capacity_litres, archived_at ON public.fuel_tanks
  FOR EACH ROW EXECUTE FUNCTION public.validate_fuel_tank_capacity();

CREATE OR REPLACE FUNCTION public.enforce_fuel_inventory_operation_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_by_name := public._fuel_inventory_actor_name();
    RETURN NEW;
  END IF;
  IF NEW.created_by IS NULL AND OLD.created_by IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.created_by)
    AND to_jsonb(NEW) - 'created_by' = to_jsonb(OLD) - 'created_by' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Fuel inventory operations are append-only';
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_fuel_inventory_void_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_by_name := public._fuel_inventory_actor_name();
    RETURN NEW;
  END IF;
  IF NEW.created_by IS NULL AND OLD.created_by IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.created_by)
    AND to_jsonb(NEW) - 'created_by' = to_jsonb(OLD) - 'created_by' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Fuel inventory voids are append-only';
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_fuel_inventory_posting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  operation_vessel_id UUID;
  tank_vessel_id UUID;
  tank_name TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Fuel inventory postings are append-only';
  END IF;
  SELECT vessel_id INTO operation_vessel_id
  FROM public.fuel_inventory_operations WHERE id = NEW.operation_id;
  SELECT vessel_id, name INTO tank_vessel_id, tank_name
  FROM public.fuel_tanks WHERE id = NEW.fuel_tank_id;
  IF operation_vessel_id IS NULL OR tank_vessel_id IS NULL
    OR operation_vessel_id <> tank_vessel_id
    OR NEW.vessel_id <> operation_vessel_id THEN
    RAISE EXCEPTION 'Fuel inventory posting vessel does not match its operation and tank';
  END IF;
  NEW.tank_name_snapshot := tank_name;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_fuel_inventory_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.vessels WHERE id = OLD.vessel_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Fuel inventory audit records cannot be deleted';
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_fuel_inventory_legacy_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Preserve the actor's immutable name snapshot while allowing the narrow FK
  -- ON DELETE SET NULL cleanup PostgreSQL performs after that user is removed.
  IF TG_OP = 'UPDATE'
    AND NEW.created_by IS NULL AND OLD.created_by IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.created_by)
    AND to_jsonb(NEW) - 'created_by' = to_jsonb(OLD) - 'created_by' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE'
    AND NOT EXISTS (SELECT 1 FROM public.vessels WHERE id = OLD.vessel_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Legacy fuel source audits are append-only';
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_vessel_fuel_settings_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_vessel_id UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.vessel_id ELSE NEW.vessel_id END;
BEGIN
  -- Preserve vessel cascade deletion while preventing API clients from
  -- clearing the activation boundary or mutating settings around the audited
  -- setup/activation RPCs.
  IF TG_OP = 'DELETE'
    AND NOT EXISTS (SELECT 1 FROM public.vessels WHERE id = affected_vessel_id) THEN
    RETURN OLD;
  END IF;
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Vessel fuel settings must be changed through fuel setup and activation RPCs';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_fuel_tank_lifecycle_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Fuel tank creation time is immutable';
  END IF;
  IF current_user IN ('anon', 'authenticated')
    AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'Fuel tanks must be archived through the fuel setup RPC';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_fuel_inventory_source_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_vessel_id UUID := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.vessel_id END;
  new_vessel_id UUID := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.vessel_id END;
  affected_vessel_id UUID := COALESCE(new_vessel_id, old_vessel_id);
  old_linked_operation_id UUID := CASE WHEN TG_OP = 'INSERT' THEN NULL
    ELSE OLD.current_inventory_operation_id END;
  new_linked_operation_id UUID := CASE WHEN TG_OP = 'DELETE' THEN NULL
    ELSE NEW.current_inventory_operation_id END;
BEGIN
  IF TG_OP = 'DELETE'
    AND NOT EXISTS (SELECT 1 FROM public.vessels WHERE id = old_vessel_id) THEN
    RETURN OLD;
  END IF;
  -- API roles may never bypass activated-ledger writes with a client-settable
  -- GUC.  The approved SECURITY DEFINER RPCs execute their source-table
  -- statements as the function owner; service/admin maintenance is therefore
  -- explicit in the executing database role rather than ambient session data.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Permit only the FK cleanup after a voiding actor profile is removed.
  IF TG_OP = 'UPDATE' AND NEW.voided_by IS NULL AND OLD.voided_by IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.voided_by)
    AND to_jsonb(NEW) - 'voided_by' = to_jsonb(OLD) - 'voided_by' THEN
    RETURN NEW;
  END IF;

  -- A source row cannot be moved from an activated vessel to an inactive one
  -- to evade the activation gate. The installed transfer client repeats the
  -- unchanged vessel_id in its UPDATE payload, which remains compatible.
  IF TG_OP = 'UPDATE' AND new_vessel_id IS DISTINCT FROM old_vessel_id THEN
    RAISE EXCEPTION 'Fuel source records cannot be moved between vessels';
  END IF;

  -- Once a current client has amended or voided a report-only source row, its
  -- before/after audit is immutable. An installed build must not subsequently
  -- rewrite or delete that source and make the retained evidence diverge.
  -- Untouched revision-zero rows remain compatible throughout pre-activation.
  IF TG_OP IN ('UPDATE', 'DELETE')
    AND (
      COALESCE(OLD.inventory_revision, 0) <> 0
      OR OLD.voided_at IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'This audited fuel record requires the current app version before it can be changed';
  END IF;

  -- During the rolling-upgrade window an installed client can still edit the
  -- local report date/time, but it cannot write the server-owned UTC evidence
  -- columns. Preserve the recorded ship offset and recompute the instant so
  -- those two representations never contradict each other. Truly old rows
  -- retain NULL/NULL because their historical offset is unknowable.
  IF TG_OP = 'UPDATE' AND OLD.effective_at IS NOT NULL THEN
    -- Branch on the concrete trigger relation before touching relation-specific
    -- RECORD fields. PostgreSQL resolves a NEW/OLD field access even when it is
    -- placed behind a boolean guard, so a combined condition would try to read
    -- log_date from a fuel_transfers row (and vice versa).
    IF TG_TABLE_NAME = 'fuel_logs' THEN
      IF (NEW.log_date, NEW.log_time)
        IS DISTINCT FROM (OLD.log_date, OLD.log_time) THEN
        NEW.effective_at := (
          (NEW.log_date + NEW.log_time::TIME)
            - make_interval(mins => OLD.utc_offset_minutes)
        ) AT TIME ZONE 'UTC';
        NEW.utc_offset_minutes := OLD.utc_offset_minutes;
      END IF;
    ELSIF TG_TABLE_NAME = 'fuel_transfers' THEN
      IF (NEW.transfer_date, NEW.transfer_time)
        IS DISTINCT FROM (OLD.transfer_date, OLD.transfer_time) THEN
        NEW.effective_at := (
          (NEW.transfer_date + NEW.transfer_time)
            - make_interval(mins => OLD.utc_offset_minutes)
        ) AT TIME ZONE 'UTC';
        NEW.utc_offset_minutes := OLD.utc_offset_minutes;
      END IF;
    END IF;
    IF NEW.effective_at > clock_timestamp() + INTERVAL '5 minutes' THEN
      RAISE EXCEPTION 'Fuel source effective time cannot be in the future';
    END IF;
  END IF;

  -- Direct legacy writes and activation use the same transaction-scoped lock.
  -- Without this serialization, a write could pass an earlier inactive read
  -- and commit immediately after activation without a ledger operation.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'fuel-inventory-vessel:' || affected_vessel_id::TEXT,
    0
  ));

  IF old_linked_operation_id IS NOT NULL
    OR new_linked_operation_id IS NOT NULL
    OR EXISTS (
    SELECT 1 FROM public.vessel_fuel_settings
    WHERE vessel_id IN (old_vessel_id, new_vessel_id)
      AND inventory_activated_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Activated fuel inventory records must be changed through inventory RPCs';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.deferred_validate_fuel_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_operation_id UUID;
  affected_tanks UUID[];
BEGIN
  IF TG_TABLE_NAME = 'fuel_inventory_operations' THEN
    affected_operation_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'fuel_inventory_postings' THEN
    affected_operation_id := NEW.operation_id;
  ELSE
    affected_operation_id := NEW.operation_id;
  END IF;

  -- A final-member account deletion cascades the vessel, operation, postings,
  -- and voids in one transaction. Deferred INSERT checks can still be queued
  -- for rows that no longer exist by commit time; there is nothing left to
  -- validate in that deliberate parent cascade.
  IF NOT EXISTS (
    SELECT 1 FROM public.fuel_inventory_operations
    WHERE id = affected_operation_id
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM public._validate_fuel_inventory_operation(affected_operation_id);
  SELECT array_agg(DISTINCT fuel_tank_id ORDER BY fuel_tank_id) INTO affected_tanks
  FROM public.fuel_inventory_postings WHERE operation_id = affected_operation_id;
  IF affected_tanks IS NOT NULL THEN
    PERFORM public._validate_fuel_inventory_timelines(affected_tanks);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_fuel_inventory_operation_actor()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_fuel_inventory_void_actor()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_fuel_inventory_posting()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_fuel_inventory_delete()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_fuel_inventory_legacy_audit_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_vessel_fuel_settings_write()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_fuel_tank_lifecycle_write()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_fuel_inventory_source_write()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deferred_validate_fuel_inventory()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_fuel_inventory_operation_actor
  ON public.fuel_inventory_operations;
CREATE TRIGGER enforce_fuel_inventory_operation_actor
  BEFORE INSERT OR UPDATE ON public.fuel_inventory_operations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fuel_inventory_operation_actor();
DROP TRIGGER IF EXISTS reject_fuel_inventory_operation_delete
  ON public.fuel_inventory_operations;
CREATE TRIGGER reject_fuel_inventory_operation_delete
  BEFORE DELETE ON public.fuel_inventory_operations
  FOR EACH ROW EXECUTE FUNCTION public.reject_fuel_inventory_delete();

DROP TRIGGER IF EXISTS enforce_fuel_inventory_posting
  ON public.fuel_inventory_postings;
CREATE TRIGGER enforce_fuel_inventory_posting
  BEFORE INSERT OR UPDATE ON public.fuel_inventory_postings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fuel_inventory_posting();
DROP TRIGGER IF EXISTS reject_fuel_inventory_posting_delete
  ON public.fuel_inventory_postings;
CREATE TRIGGER reject_fuel_inventory_posting_delete
  BEFORE DELETE ON public.fuel_inventory_postings
  FOR EACH ROW EXECUTE FUNCTION public.reject_fuel_inventory_delete();

DROP TRIGGER IF EXISTS enforce_fuel_inventory_void_actor
  ON public.fuel_inventory_voids;
CREATE TRIGGER enforce_fuel_inventory_void_actor
  BEFORE INSERT OR UPDATE ON public.fuel_inventory_voids
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fuel_inventory_void_actor();
DROP TRIGGER IF EXISTS reject_fuel_inventory_void_delete
  ON public.fuel_inventory_voids;
CREATE TRIGGER reject_fuel_inventory_void_delete
  BEFORE DELETE ON public.fuel_inventory_voids
  FOR EACH ROW EXECUTE FUNCTION public.reject_fuel_inventory_delete();

DROP TRIGGER IF EXISTS reject_fuel_inventory_legacy_audit_mutation
  ON public.fuel_inventory_legacy_source_audits;
CREATE TRIGGER reject_fuel_inventory_legacy_audit_mutation
  BEFORE UPDATE OR DELETE ON public.fuel_inventory_legacy_source_audits
  FOR EACH ROW EXECUTE FUNCTION public.reject_fuel_inventory_legacy_audit_mutation();

DROP TRIGGER IF EXISTS guard_vessel_fuel_settings_write
  ON public.vessel_fuel_settings;
CREATE TRIGGER guard_vessel_fuel_settings_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.vessel_fuel_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_vessel_fuel_settings_write();

DROP TRIGGER IF EXISTS guard_fuel_tank_lifecycle_write ON public.fuel_tanks;
CREATE TRIGGER guard_fuel_tank_lifecycle_write
  BEFORE UPDATE OF created_at, archived_at ON public.fuel_tanks
  FOR EACH ROW EXECUTE FUNCTION public.guard_fuel_tank_lifecycle_write();

DROP TRIGGER IF EXISTS guard_fuel_inventory_fuel_log_write ON public.fuel_logs;
CREATE TRIGGER guard_fuel_inventory_fuel_log_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.fuel_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_fuel_inventory_source_write();
DROP TRIGGER IF EXISTS guard_fuel_inventory_transfer_write ON public.fuel_transfers;
CREATE TRIGGER guard_fuel_inventory_transfer_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.fuel_transfers
  FOR EACH ROW EXECUTE FUNCTION public.guard_fuel_inventory_source_write();

DROP TRIGGER IF EXISTS deferred_validate_fuel_inventory_operation
  ON public.fuel_inventory_operations;
CREATE CONSTRAINT TRIGGER deferred_validate_fuel_inventory_operation
  AFTER INSERT ON public.fuel_inventory_operations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.deferred_validate_fuel_inventory();
DROP TRIGGER IF EXISTS deferred_validate_fuel_inventory_posting
  ON public.fuel_inventory_postings;
CREATE CONSTRAINT TRIGGER deferred_validate_fuel_inventory_posting
  AFTER INSERT ON public.fuel_inventory_postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.deferred_validate_fuel_inventory();
DROP TRIGGER IF EXISTS deferred_validate_fuel_inventory_void
  ON public.fuel_inventory_voids;
CREATE CONSTRAINT TRIGGER deferred_validate_fuel_inventory_void
  AFTER INSERT ON public.fuel_inventory_voids
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.deferred_validate_fuel_inventory();

ALTER TABLE public.fuel_inventory_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_inventory_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_inventory_voids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_inventory_request_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_inventory_legacy_source_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vessel members read fuel inventory operations"
  ON public.fuel_inventory_operations;
CREATE POLICY "Vessel members read fuel inventory operations"
  ON public.fuel_inventory_operations FOR SELECT TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id));
DROP POLICY IF EXISTS "Vessel members read fuel inventory postings"
  ON public.fuel_inventory_postings;
CREATE POLICY "Vessel members read fuel inventory postings"
  ON public.fuel_inventory_postings FOR SELECT TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id));
DROP POLICY IF EXISTS "Vessel members read fuel inventory voids"
  ON public.fuel_inventory_voids;
CREATE POLICY "Vessel members read fuel inventory voids"
  ON public.fuel_inventory_voids FOR SELECT TO authenticated
  USING (public.current_user_can_access_vessel(vessel_id));

-- Baseline grants included ALL table privileges.  Least-privilege revocation
-- must therefore include TRUNCATE, REFERENCES, and TRIGGER as well as row DML;
-- TRUNCATE in particular bypasses RLS and row triggers entirely. Catalogue and
-- ledger writes stay RPC-only. A narrow, temporary set of source-report columns
-- is reopened below for the installed client and guarded by the activation lock.
REVOKE ALL ON TABLE
  public.vessel_fuel_settings,
  public.fuel_tanks,
  public.fuel_logs,
  public.fuel_log_tank_entries,
  public.fuel_transfers,
  public.fuel_inventory_operations,
  public.fuel_inventory_postings,
  public.fuel_inventory_voids,
  public.fuel_inventory_request_results,
  public.fuel_inventory_legacy_source_audits
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.vessel_fuel_settings,
  public.fuel_tanks,
  public.fuel_logs,
  public.fuel_log_tank_entries,
  public.fuel_transfers,
  public.fuel_inventory_operations,
  public.fuel_inventory_postings,
  public.fuel_inventory_voids
TO authenticated;

-- Temporary DB-first compatibility for the installed client. Only the source
-- columns that client already writes are reopened; actor, audit, ledger-link,
-- revision, void, timestamp, child-allocation, and ledger-table mutation remain
-- private. The serialized source-write trigger above closes this path for each
-- vessel atomically when inventory is activated.
GRANT INSERT (
    vessel_id,
    location_of_refueling,
    log_date,
    log_time,
    amount_of_fuel,
    price_per_gallon,
    total_price,
    created_by_name,
    volume_unit,
    currency_code,
    comment
  ),
  UPDATE (
    location_of_refueling,
    log_date,
    log_time,
    amount_of_fuel,
    price_per_gallon,
    total_price,
    volume_unit,
    currency_code,
    comment
  )
ON TABLE public.fuel_logs TO authenticated;
GRANT DELETE ON TABLE public.fuel_logs TO authenticated;

GRANT INSERT (
    vessel_id,
    source_tank_id,
    destination_tank_id,
    amount_litres,
    transfer_date,
    transfer_time,
    location,
    notes
  ),
  UPDATE (
    vessel_id,
    source_tank_id,
    destination_tank_id,
    amount_litres,
    transfer_date,
    transfer_time,
    location,
    notes
  )
ON TABLE public.fuel_transfers TO authenticated;
GRANT DELETE ON TABLE public.fuel_transfers TO authenticated;

-- API roles never read the private idempotency replay registry directly.
-- Its exact result payload is returned only by the authorized definer RPC.
REVOKE ALL ON SEQUENCE
  public.fuel_inventory_effective_order_seq,
  public.fuel_inventory_audit_sequence_seq,
  public.fuel_inventory_operations_recorded_sequence_seq
FROM PUBLIC, anon, authenticated;
