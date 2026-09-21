-- One-screen multi-tank fuel receipts.
--
-- A manager may add new vessel tanks while recording a receipt. Tank setup,
-- explicit opening levels (after inventory activation), receipt allocations and
-- ledger postings are committed in one transaction so the app cannot leave a
-- partially saved setup behind. Existing receipt and ledger tables remain the
-- only sources of truth.

ALTER TABLE public.fuel_logs
  ADD COLUMN IF NOT EXISTS price_volume_unit TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fuel_logs_price_volume_unit_check'
      AND conrelid = 'public.fuel_logs'::regclass
  ) THEN
    ALTER TABLE public.fuel_logs
      ADD CONSTRAINT fuel_logs_price_volume_unit_check
      CHECK (
        price_volume_unit IS NULL
        OR price_volume_unit IN ('LITRES', 'US_GALLONS')
      );
  END IF;
END;
$$;

UPDATE public.fuel_logs
SET price_volume_unit = COALESCE(volume_unit, 'US_GALLONS')
WHERE price_volume_unit IS NULL;

COMMENT ON COLUMN public.fuel_logs.price_volume_unit IS
  'Unit used to quote price_per_gallon. NULL from an older client falls back to volume_unit, then US_GALLONS.';

-- The inactive-inventory path stores the exact committed receipt response for
-- offline-safe retries. Extend the existing closed set before that path can be
-- used; otherwise the whole atomic receipt would roll back at the final insert.
ALTER TABLE public.fuel_inventory_request_results
  DROP CONSTRAINT IF EXISTS fuel_inventory_request_results_kind_check;
ALTER TABLE public.fuel_inventory_request_results
  ADD CONSTRAINT fuel_inventory_request_results_kind_check CHECK (
    request_kind IN (
      'LEGACY_REFUEL_CREATE', 'LEGACY_REFUEL_AMEND', 'LEGACY_REFUEL_VOID',
      'LEGACY_TRANSFER_CREATE', 'LEGACY_TRANSFER_AMEND',
      'LEGACY_TRANSFER_VOID', 'FUEL_SETUP_SAVE', 'FUEL_RECEIPT_CREATE'
    )
  );

CREATE OR REPLACE FUNCTION public.create_fuel_receipt_with_tanks(
  p_log JSONB,
  p_entries JSONB,
  p_new_tanks JSONB,
  p_expected_setup_revision INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_vessel_id UUID;
  client_request_id UUID;
  effective_at TIMESTAMPTZ;
  utc_offset_minutes SMALLINT;
  local_log_date DATE;
  local_log_time TIME;
  price_volume_unit TEXT;
  receipt_volume_unit TEXT;
  receipt_price NUMERIC;
  receipt_total NUMERIC;
  allocation_litres NUMERIC;
  expected_total NUMERIC;
  inventory_active BOOLEAN;
  inventory_activated_at TIMESTAMPTZ;
  current_revision INTEGER;
  request_payload JSONB;
  request_fingerprint TEXT;
  existing_request_result JSONB;
  existing_operation_id UUID;
  operation_id UUID := gen_random_uuid();
  opening_operation_id UUID := gen_random_uuid();
  opening_client_request_id UUID;
  opening_fingerprint TEXT;
  actor_name TEXT;
  created_log JSONB;
  created_fuel_log_id UUID;
  tank_ids UUID[];
  new_tank_ids UUID[];
BEGIN
  IF p_log IS NULL OR jsonb_typeof(p_log) <> 'object' THEN
    RAISE EXCEPTION 'Fuel log must be supplied as an object';
  END IF;
  target_vessel_id := NULLIF(p_log ->> 'vessel_id', '')::UUID;
  IF target_vessel_id IS NULL
    OR NOT public.current_user_can_access_vessel(target_vessel_id) THEN
    RAISE EXCEPTION 'Only active vessel members can create fuel logs';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array'
    OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'At least one tank allocation is required';
  END IF;
  IF p_new_tanks IS NULL OR jsonb_typeof(p_new_tanks) <> 'array' THEN
    RAISE EXCEPTION 'New fuel tanks must be supplied as an array';
  END IF;

  client_request_id := NULLIF(p_log ->> 'client_request_id', '')::UUID;
  effective_at := NULLIF(p_log ->> 'effective_at', '')::TIMESTAMPTZ;
  utc_offset_minutes := NULLIF(p_log ->> 'utc_offset_minutes', '')::SMALLINT;
  local_log_date := (p_log ->> 'log_date')::DATE;
  local_log_time := (p_log ->> 'log_time')::TIME;
  receipt_volume_unit := p_log ->> 'volume_unit';
  price_volume_unit := COALESCE(
    NULLIF(p_log ->> 'price_volume_unit', ''),
    receipt_volume_unit
  );
  receipt_price := (p_log ->> 'price_per_gallon')::NUMERIC;
  receipt_total := (p_log ->> 'total_price')::NUMERIC;

  IF client_request_id IS NULL THEN
    RAISE EXCEPTION 'A client request ID is required';
  END IF;
  PERFORM public._validate_fuel_inventory_effective_time(
    effective_at, utc_offset_minutes, local_log_date, local_log_time
  );
  IF receipt_volume_unit IS NULL
    OR receipt_volume_unit NOT IN ('LITRES', 'US_GALLONS')
    OR price_volume_unit IS NULL
    OR price_volume_unit NOT IN ('LITRES', 'US_GALLONS') THEN
    RAISE EXCEPTION 'Fuel quantity and price units must be LITRES or US_GALLONS';
  END IF;
  IF receipt_price IS NULL OR receipt_price::TEXT IN ('NaN', 'Infinity', '-Infinity')
    OR receipt_price <= 0 OR receipt_price IS DISTINCT FROM round(receipt_price, 4)
    OR receipt_total IS NULL OR receipt_total::TEXT IN ('NaN', 'Infinity', '-Infinity')
    OR receipt_total < 0 OR receipt_total IS DISTINCT FROM round(receipt_total, 2) THEN
    RAISE EXCEPTION 'Fuel receipt price and total must be valid positive values';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_entries) AS entry(
      fuel_tank_id UUID, amount_litres NUMERIC
    )
    WHERE entry.fuel_tank_id IS NULL OR entry.amount_litres IS NULL
      OR entry.amount_litres::TEXT IN ('NaN', 'Infinity', '-Infinity')
      OR entry.amount_litres <= 0
      OR entry.amount_litres IS DISTINCT FROM round(entry.amount_litres, 3)
  ) THEN
    RAISE EXCEPTION 'Every tank allocation requires a tank and a positive amount with at most three decimal places';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT fuel_tank_id
      FROM jsonb_to_recordset(p_entries) AS entry(
        fuel_tank_id UUID, amount_litres NUMERIC
      )
      GROUP BY fuel_tank_id HAVING count(*) > 1
    ) AS duplicate_entries
  ) THEN
    RAISE EXCEPTION 'A tank may only appear once in a fuel receipt';
  END IF;

  SELECT COALESCE(sum(entry.amount_litres), 0)
  INTO allocation_litres
  FROM jsonb_to_recordset(p_entries) AS entry(
    fuel_tank_id UUID, amount_litres NUMERIC
  );
  expected_total := round((CASE
    WHEN price_volume_unit = 'LITRES' THEN allocation_litres
    ELSE allocation_litres / 3.785411784
  END) * receipt_price, 2);
  IF abs(receipt_total - expected_total) > 0.01 THEN
    RAISE EXCEPTION 'Fuel receipt total must equal the delivered quantity multiplied by its unit price';
  END IF;
  -- PostgreSQL NUMERIC is authoritative at half-cent boundaries where mobile
  -- binary floating-point can differ by one cent. A one-cent-equivalent input
  -- is normalized to the exact database result before fingerprinting/storage,
  -- so the persisted price and total can never disagree.
  receipt_total := expected_total;
  p_log := jsonb_set(p_log, '{total_price}', to_jsonb(expected_total), TRUE);

  IF jsonb_array_length(p_new_tanks) > 0 THEN
    IF NOT public.current_user_can_manage_vessel(target_vessel_id) THEN
      RAISE EXCEPTION 'Only an HOD or Captain/MOV can add vessel fuel tanks';
    END IF;
    IF p_expected_setup_revision IS NULL OR p_expected_setup_revision < 0 THEN
      RAISE EXCEPTION 'Adding tanks requires the current fuel setup revision';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_new_tanks) AS tank(
        id UUID, name TEXT, location TEXT, description TEXT,
        capacity_litres NUMERIC, opening_litres NUMERIC
      )
      WHERE tank.id IS NULL
        OR char_length(btrim(tank.name)) NOT BETWEEN 1 AND 120
        OR COALESCE(char_length(tank.location), 0) > 240
        OR COALESCE(char_length(tank.description), 0) > 2000
        OR tank.capacity_litres IS NULL
        OR tank.capacity_litres::TEXT IN ('NaN', 'Infinity', '-Infinity')
        OR tank.capacity_litres <= 0
        OR tank.capacity_litres IS DISTINCT FROM round(tank.capacity_litres, 3)
        OR tank.opening_litres IS NULL
        OR tank.opening_litres::TEXT IN ('NaN', 'Infinity', '-Infinity')
        OR tank.opening_litres < 0
        OR tank.opening_litres > tank.capacity_litres
        OR tank.opening_litres IS DISTINCT FROM round(tank.opening_litres, 3)
    ) THEN
      RAISE EXCEPTION 'Every new tank requires a valid name, capacity and opening level';
    END IF;
    IF EXISTS (
      SELECT 1 FROM (
        SELECT id
        FROM jsonb_to_recordset(p_new_tanks) AS tank(
          id UUID, name TEXT, location TEXT, description TEXT,
          capacity_litres NUMERIC, opening_litres NUMERIC
        ) GROUP BY id HAVING count(*) > 1
      ) AS duplicate_ids
    ) OR EXISTS (
      SELECT 1 FROM (
        SELECT lower(btrim(name)) AS normalized_name
        FROM jsonb_to_recordset(p_new_tanks) AS tank(
          id UUID, name TEXT, location TEXT, description TEXT,
          capacity_litres NUMERIC, opening_litres NUMERIC
        ) GROUP BY lower(btrim(name)) HAVING count(*) > 1
      ) AS duplicate_names
    ) THEN
      RAISE EXCEPTION 'New fuel tank IDs and names must be unique';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_new_tanks) AS tank(
        id UUID, name TEXT, location TEXT, description TEXT,
        capacity_litres NUMERIC, opening_litres NUMERIC
      )
      WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_entries) AS entry(
          fuel_tank_id UUID, amount_litres NUMERIC
        )
        WHERE entry.fuel_tank_id = tank.id
      )
    ) THEN
      RAISE EXCEPTION 'Every new tank must receive fuel in this receipt';
    END IF;
  END IF;

  request_payload := jsonb_build_object(
    'rpc', 'create_fuel_receipt_with_tanks',
    'log', p_log - ARRAY['client_request_id'],
    'entries', p_entries,
    'new_tanks', p_new_tanks,
    'expected_setup_revision', p_expected_setup_revision
  );
  request_fingerprint := public._fuel_inventory_request_fingerprint(request_payload);
  existing_request_result := public._fuel_inventory_existing_request_result(
    target_vessel_id, client_request_id, 'FUEL_RECEIPT_CREATE', request_fingerprint
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

  PERFORM public._lock_fuel_inventory_vessel(target_vessel_id);
  SELECT
    settings.setup_revision,
    settings.inventory_activated_at,
    settings.inventory_activated_at IS NOT NULL
  INTO current_revision, inventory_activated_at, inventory_active
  FROM public.vessel_fuel_settings AS settings
  WHERE settings.vessel_id = target_vessel_id;
  current_revision := COALESCE(current_revision, 0);
  inventory_active := COALESCE(inventory_active, FALSE);

  IF jsonb_array_length(p_new_tanks) > 0 THEN
    IF current_revision IS DISTINCT FROM p_expected_setup_revision THEN
      RAISE EXCEPTION 'Fuel setup changed since it was loaded; refresh and try again';
    END IF;
    IF inventory_active AND effective_at < inventory_activated_at THEN
      RAISE EXCEPTION 'A new tank cannot be introduced before fuel inventory activation';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_new_tanks) AS requested(
        id UUID, name TEXT, location TEXT, description TEXT,
        capacity_litres NUMERIC, opening_litres NUMERIC
      )
      LEFT JOIN public.fuel_tanks AS existing_id ON existing_id.id = requested.id
      LEFT JOIN public.fuel_tanks AS existing_name
        ON existing_name.vessel_id = target_vessel_id
       AND existing_name.archived_at IS NULL
       AND lower(btrim(existing_name.name)) = lower(btrim(requested.name))
      WHERE existing_id.id IS NOT NULL OR existing_name.id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'A new tank ID or name already exists';
    END IF;

    INSERT INTO public.fuel_tanks (
      id, vessel_id, name, location, description, capacity_litres,
      created_at, updated_at
    )
    SELECT tank.id, target_vessel_id, btrim(tank.name),
      COALESCE(btrim(tank.location), ''), COALESCE(btrim(tank.description), ''),
      tank.capacity_litres,
      LEAST(clock_timestamp(), date_trunc('minute', effective_at)),
      clock_timestamp()
    FROM jsonb_to_recordset(p_new_tanks) AS tank(
      id UUID, name TEXT, location TEXT, description TEXT,
      capacity_litres NUMERIC, opening_litres NUMERIC
    );

    INSERT INTO public.vessel_fuel_settings (
      vessel_id, volume_unit, setup_revision
    ) VALUES (
      target_vessel_id, receipt_volume_unit, current_revision + 1
    )
    ON CONFLICT (vessel_id) DO UPDATE SET
      setup_revision = EXCLUDED.setup_revision;

    SELECT array_agg(tank.id ORDER BY tank.id)
    INTO new_tank_ids
    FROM jsonb_to_recordset(p_new_tanks) AS tank(
      id UUID, name TEXT, location TEXT, description TEXT,
      capacity_litres NUMERIC, opening_litres NUMERIC
    );
    PERFORM public._lock_fuel_inventory_tanks(new_tank_ids);

    IF inventory_active THEN
      actor_name := public._fuel_inventory_actor_name();
      opening_client_request_id := md5(client_request_id::TEXT || ':inline-opening')::UUID;
      opening_fingerprint := public._fuel_inventory_request_fingerprint(
        jsonb_build_object(
          'rpc', 'create_fuel_receipt_with_tanks:opening',
          'receipt_request_id', client_request_id,
          'new_tanks', p_new_tanks,
          'effective_at', effective_at,
          'utc_offset_minutes', utc_offset_minutes
        )
      );
      INSERT INTO public.fuel_inventory_operations (
        id, vessel_id, logical_operation_id, revision_no, operation_type,
        effective_at, utc_offset_minutes, metadata, client_request_id,
        request_fingerprint, created_by, created_by_name
      ) VALUES (
        opening_operation_id, target_vessel_id, opening_operation_id, 1, 'OPENING',
        effective_at, utc_offset_minutes,
        jsonb_build_object(
          'notes', 'Tank added while recording a fuel receipt',
          'receipt_request_id', client_request_id
        ),
        opening_client_request_id, opening_fingerprint, auth.uid(), actor_name
      );
      INSERT INTO public.fuel_inventory_postings (
        operation_id, vessel_id, fuel_tank_id, posting_mode,
        amount_litres, tank_name_snapshot
      )
      SELECT opening_operation_id, target_vessel_id, tank.id, 'ABSOLUTE',
        requested.opening_litres, tank.name
      FROM jsonb_to_recordset(p_new_tanks) AS requested(
        id UUID, name TEXT, location TEXT, description TEXT,
        capacity_litres NUMERIC, opening_litres NUMERIC
      )
      JOIN public.fuel_tanks AS tank ON tank.id = requested.id;
      PERFORM public._validate_fuel_inventory_operation(opening_operation_id);
      PERFORM public._validate_fuel_inventory_timelines(new_tank_ids);
    END IF;
  END IF;

  SELECT array_agg(DISTINCT fuel_tank_id ORDER BY fuel_tank_id)
  INTO tank_ids
  FROM jsonb_to_recordset(p_entries) AS entry(
    fuel_tank_id UUID, amount_litres NUMERIC
  );
  PERFORM public._lock_fuel_inventory_tanks(tank_ids);
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_entries) AS entry(
      fuel_tank_id UUID, amount_litres NUMERIC
    )
    LEFT JOIN public.fuel_tanks AS tank ON tank.id = entry.fuel_tank_id
    WHERE tank.id IS NULL OR tank.vessel_id <> target_vessel_id
      OR tank.archived_at IS NOT NULL
      OR effective_at < date_trunc('minute', tank.created_at)
  ) THEN
    RAISE EXCEPTION 'Fuel allocations must use tanks active on the vessel at the ship time';
  END IF;

  PERFORM set_config('nautical.fuel_inventory_rpc', 'on', TRUE);
  created_log := public._create_fuel_log_with_tank_entries_legacy(p_log, p_entries);
  created_fuel_log_id := (created_log ->> 'id')::UUID;
  UPDATE public.fuel_logs
  SET effective_at = NULLIF(p_log ->> 'effective_at', '')::TIMESTAMPTZ,
      utc_offset_minutes = NULLIF(p_log ->> 'utc_offset_minutes', '')::SMALLINT,
      price_volume_unit = COALESCE(
        NULLIF(p_log ->> 'price_volume_unit', ''),
        p_log ->> 'volume_unit'
      )
  WHERE id = created_fuel_log_id;

  IF NOT inventory_active THEN
    SELECT to_jsonb(fuel_log) INTO created_log
    FROM public.fuel_logs AS fuel_log WHERE id = created_fuel_log_id;
    INSERT INTO public.fuel_inventory_request_results (
      vessel_id, client_request_id, request_kind, request_fingerprint,
      result_payload, created_by
    ) VALUES (
      target_vessel_id, client_request_id, 'FUEL_RECEIPT_CREATE',
      request_fingerprint, created_log, auth.uid()
    );
    RETURN created_log;
  END IF;

  actor_name := COALESCE(actor_name, public._fuel_inventory_actor_name());
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
      'amount_of_fuel', p_log -> 'amount_of_fuel',
      'volume_unit', receipt_volume_unit,
      'price_per_volume_unit', p_log -> 'price_per_gallon',
      'price_volume_unit', price_volume_unit,
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
  SET current_inventory_operation_id = operation_id,
      inventory_revision = 1
  WHERE id = created_fuel_log_id;
  SELECT to_jsonb(fuel_log) INTO created_log
  FROM public.fuel_logs AS fuel_log WHERE id = created_fuel_log_id;
  RETURN created_log;
END;
$$;

REVOKE ALL ON FUNCTION public.create_fuel_receipt_with_tanks(
  JSONB, JSONB, JSONB, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_fuel_receipt_with_tanks(
  JSONB, JSONB, JSONB, INTEGER
) TO authenticated;

-- Compatibility writers can explicitly retain the selected basis before fuel
-- inventory activation; RLS and the source guard still enforce vessel access.
GRANT INSERT (price_volume_unit), UPDATE (price_volume_unit)
  ON public.fuel_logs TO authenticated;
