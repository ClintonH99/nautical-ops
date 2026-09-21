-- A fuel receipt records only what was delivered during that refuelling.
-- It must not infer fuel consumed since the previous receipt or add the new
-- delivery to a remembered balance. Tank names/capacities remain shared vessel
-- setup; receipt quantities remain independent historical evidence.

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
  event_effective_at TIMESTAMPTZ;
  event_utc_offset_minutes SMALLINT;
  local_log_date DATE;
  local_log_time TIME;
  event_price_volume_unit TEXT;
  receipt_volume_unit TEXT;
  receipt_price NUMERIC;
  receipt_total NUMERIC;
  allocation_litres NUMERIC;
  expected_total NUMERIC;
  current_revision INTEGER;
  request_payload JSONB;
  request_fingerprint TEXT;
  existing_request_result JSONB;
  existing_operation_id UUID;
  created_log JSONB;
  created_fuel_log_id UUID;
  tank_ids UUID[];
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
  event_effective_at := NULLIF(p_log ->> 'effective_at', '')::TIMESTAMPTZ;
  event_utc_offset_minutes := NULLIF(p_log ->> 'utc_offset_minutes', '')::SMALLINT;
  local_log_date := (p_log ->> 'log_date')::DATE;
  local_log_time := (p_log ->> 'log_time')::TIME;
  receipt_volume_unit := p_log ->> 'volume_unit';
  event_price_volume_unit := COALESCE(
    NULLIF(p_log ->> 'price_volume_unit', ''),
    receipt_volume_unit
  );
  receipt_price := (p_log ->> 'price_per_gallon')::NUMERIC;
  receipt_total := (p_log ->> 'total_price')::NUMERIC;

  IF client_request_id IS NULL THEN
    RAISE EXCEPTION 'A client request ID is required';
  END IF;
  PERFORM public._validate_fuel_inventory_effective_time(
    event_effective_at, event_utc_offset_minutes, local_log_date, local_log_time
  );
  IF receipt_volume_unit IS NULL
    OR receipt_volume_unit NOT IN ('LITRES', 'US_GALLONS')
    OR event_price_volume_unit IS NULL
    OR event_price_volume_unit NOT IN ('LITRES', 'US_GALLONS') THEN
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
    WHEN event_price_volume_unit = 'LITRES' THEN allocation_litres
    ELSE allocation_litres / 3.785411784
  END) * receipt_price, 2);
  IF abs(receipt_total - expected_total) > 0.01 THEN
    RAISE EXCEPTION 'Fuel receipt total must equal the delivered quantity multiplied by its unit price';
  END IF;
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
    ) THEN
      RAISE EXCEPTION 'Every new tank requires a valid name and capacity';
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
    'expected_setup_revision', p_expected_setup_revision,
    'receipt_semantics', 'STANDALONE'
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
  SELECT COALESCE(settings.setup_revision, 0)
  INTO current_revision
  FROM public.vessel_fuel_settings AS settings
  WHERE settings.vessel_id = target_vessel_id;
  current_revision := COALESCE(current_revision, 0);

  IF jsonb_array_length(p_new_tanks) > 0 THEN
    IF current_revision IS DISTINCT FROM p_expected_setup_revision THEN
      RAISE EXCEPTION 'Fuel setup changed since it was loaded; refresh and try again';
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
      LEAST(clock_timestamp(), date_trunc('minute', event_effective_at)),
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
      OR event_effective_at < date_trunc('minute', tank.created_at)
  ) THEN
    RAISE EXCEPTION 'Fuel allocations must use tanks active on the vessel at the receipt time';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_entries) AS entry(
      fuel_tank_id UUID, amount_litres NUMERIC
    )
    JOIN public.fuel_tanks AS tank ON tank.id = entry.fuel_tank_id
    WHERE entry.amount_litres > tank.capacity_litres
  ) THEN
    RAISE EXCEPTION 'Fuel received cannot exceed tank capacity';
  END IF;

  -- The legacy helper atomically stores the receipt and its per-tank amounts.
  -- The RPC guard is required when inventory has previously been activated,
  -- but no inventory operation or posting is created for a standalone receipt.
  PERFORM set_config('nautical.fuel_inventory_rpc', 'on', TRUE);
  created_log := public._create_fuel_log_with_tank_entries_legacy(p_log, p_entries);
  created_fuel_log_id := (created_log ->> 'id')::UUID;
  UPDATE public.fuel_logs
  SET effective_at = event_effective_at,
      utc_offset_minutes = event_utc_offset_minutes,
      price_volume_unit = event_price_volume_unit,
      current_inventory_operation_id = NULL,
      inventory_revision = 0
  WHERE id = created_fuel_log_id;
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
END;
$$;

REVOKE ALL ON FUNCTION public.create_fuel_receipt_with_tanks(
  JSONB, JSONB, JSONB, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_fuel_receipt_with_tanks(
  JSONB, JSONB, JSONB, INTEGER
) TO authenticated;

COMMENT ON FUNCTION public.create_fuel_receipt_with_tanks(
  JSONB, JSONB, JSONB, INTEGER
) IS 'Creates a standalone fuel receipt. Each per-tank amount starts blank, is limited only by tank capacity, and never carries a previous receipt balance forward.';
