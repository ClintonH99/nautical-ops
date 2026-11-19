-- Optional, manually entered fuel receipt tax. Historical rows are not rewritten.
ALTER TABLE public.fuel_logs
  ADD COLUMN tax_percentage NUMERIC,
  ADD COLUMN tax_amount NUMERIC;
ALTER TABLE public.fuel_logs ADD CONSTRAINT fuel_logs_manual_tax_valid CHECK (
  (tax_percentage IS NULL AND COALESCE(tax_amount, 0) = 0)
  OR (tax_percentage IS NOT NULL AND tax_percentage BETWEEN 0 AND 100
    AND tax_percentage = round(tax_percentage, 4)
    AND tax_amount IS NOT NULL AND tax_amount >= 0 AND tax_amount <= total_price
    AND tax_amount = round(tax_amount, 2)
    AND tax_amount = round((total_price - tax_amount) * tax_percentage / 100, 2))
);
COMMENT ON COLUMN public.fuel_logs.tax_percentage IS 'User-entered percentage. NULL means not recorded; no regional rate is inferred.';
COMMENT ON COLUMN public.fuel_logs.tax_amount IS 'Tax on the rounded pre-tax subtotal. total_price includes this amount.';

CREATE OR REPLACE FUNCTION public._fuel_receipt_tax_values(net NUMERIC, rate NUMERIC)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE subtotal NUMERIC; tax NUMERIC;
BEGIN
  IF net IS NULL OR net::text IN ('NaN','Infinity','-Infinity') OR net < 0
    OR (rate IS NOT NULL AND (rate::text IN ('NaN','Infinity','-Infinity')
      OR rate < 0 OR rate > 100 OR rate <> round(rate, 4))) THEN
    RAISE EXCEPTION 'Fuel tax requires a non-negative subtotal and a percentage from 0 to 100 with up to four decimal places';
  END IF;
  subtotal := round(net, 2);
  tax := round(subtotal * COALESCE(rate, 0) / 100, 2);
  RETURN jsonb_build_object('tax_percentage', rate, 'tax_amount', tax, 'total_price', subtotal + tax);
END; $$;
REVOKE ALL ON FUNCTION public._fuel_receipt_tax_values(NUMERIC,NUMERIC) FROM PUBLIC, anon, authenticated;

-- Called after revision/idempotency checks, so retries retain their original fingerprint.
-- Missing tax fields from older installed clients preserve a receipt's recorded rate.
CREATE OR REPLACE FUNCTION public._fuel_receipt_tax_patch(old_row JSONB, patch JSONB, entries JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE rate NUMERIC; net NUMERIC; price NUMERIC; quantity NUMERIC; litres NUMERIC;
  price_unit TEXT; volume_unit TEXT; amounts JSONB;
BEGIN
  IF NOT patch ? 'tax_percentage' AND old_row->>'tax_percentage' IS NULL THEN
    RETURN patch - 'tax_amount';
  END IF;
  rate := CASE WHEN patch ? 'tax_percentage' THEN (patch->>'tax_percentage')::numeric
    ELSE (old_row->>'tax_percentage')::numeric END;
  price := COALESCE((patch->>'price_per_gallon')::numeric,(old_row->>'price_per_gallon')::numeric);
  quantity := COALESCE((patch->>'amount_of_fuel')::numeric,(old_row->>'amount_of_fuel')::numeric);
  volume_unit := COALESCE(patch->>'volume_unit',old_row->>'volume_unit','US_GALLONS');
  price_unit := COALESCE(patch->>'price_volume_unit',old_row->>'price_volume_unit',volume_unit);
  IF price IS NOT DISTINCT FROM (old_row->>'price_per_gallon')::numeric
    AND quantity IS NOT DISTINCT FROM (old_row->>'amount_of_fuel')::numeric
    AND volume_unit = COALESCE(old_row->>'volume_unit','US_GALLONS')
    AND price_unit = COALESCE(old_row->>'price_volume_unit',old_row->>'volume_unit','US_GALLONS') THEN
    net := (old_row->>'total_price')::numeric - COALESCE((old_row->>'tax_amount')::numeric,0);
  ELSE
    IF jsonb_array_length(entries) > 0 THEN
      SELECT sum((e->>'amount_litres')::numeric) INTO litres FROM jsonb_array_elements(entries) e;
    ELSE
      litres := quantity * CASE WHEN volume_unit='LITRES' THEN 1 ELSE 3.785411784 END;
    END IF;
    net := litres / CASE WHEN price_unit='LITRES' THEN 1 ELSE 3.785411784 END * price;
  END IF;
  amounts := public._fuel_receipt_tax_values(net,rate);
  IF patch ? 'tax_percentage' AND patch ? 'total_price'
    AND abs((patch->>'total_price')::numeric - (amounts->>'total_price')::numeric) > 0.01 THEN
    RAISE EXCEPTION 'Fuel receipt total does not match subtotal plus tax';
  END IF;
  RETURN patch || amounts;
END; $$;
REVOKE ALL ON FUNCTION public._fuel_receipt_tax_patch(JSONB,JSONB,JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_fuel_receipt_with_tanks(p_log jsonb, p_entries jsonb, p_new_tanks jsonb, p_expected_setup_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF p_log ? 'tax_percentage' THEN
    p_log := p_log || public._fuel_receipt_tax_values(expected_total, (p_log->>'tax_percentage')::NUMERIC);
    expected_total := (p_log->>'total_price')::NUMERIC;
  ELSE
    p_log := p_log - 'tax_amount';
  END IF;
  IF abs(receipt_total - expected_total) > 0.01 THEN
    RAISE EXCEPTION 'Fuel receipt total must equal the delivered quantity multiplied by its unit price, plus any recorded tax';
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
$function$;



CREATE OR REPLACE FUNCTION public._update_fuel_log_with_tank_entries_legacy(p_fuel_log_id uuid, p_vessel_id uuid, p_log_patch jsonb, p_entries jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    tax_percentage = CASE WHEN p_log_patch ? 'tax_percentage' THEN (p_log_patch->>'tax_percentage')::numeric ELSE v_existing.tax_percentage END,
    tax_amount = CASE WHEN p_log_patch ? 'tax_amount' THEN (p_log_patch->>'tax_amount')::numeric ELSE v_existing.tax_amount END,
    price_volume_unit = COALESCE(p_log_patch->>'price_volume_unit', v_existing.price_volume_unit),
    volume_unit = v_volume_unit,
    currency_code = v_currency_code,
    comment = v_comment
  WHERE id = p_fuel_log_id
  RETURNING * INTO v_updated;

  RETURN to_jsonb(v_updated);
END;
$function$;



CREATE OR REPLACE FUNCTION public.create_fuel_log_with_tank_entries(p_log jsonb, p_entries jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF p_log ? 'tax_percentage' THEN
    p_log := p_log || public._fuel_receipt_tax_values(
      (SELECT sum((e->>'amount_litres')::numeric) FROM jsonb_array_elements(p_entries) e)
      / CASE WHEN COALESCE(p_log->>'price_volume_unit',p_log->>'volume_unit')='LITRES' THEN 1 ELSE 3.785411784 END
      * (p_log->>'price_per_gallon')::numeric, (p_log->>'tax_percentage')::numeric);
  ELSE
    p_log := p_log - 'tax_amount';
  END IF;
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
$function$;



CREATE OR REPLACE FUNCTION public._create_fuel_log_with_tank_entries_legacy(p_log jsonb, p_entries jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    price_per_gallon, total_price, volume_unit, currency_code, comment, tax_percentage, tax_amount, price_volume_unit
  )
  VALUES (
    v_vessel_id, v_location, v_log_date, btrim(v_log_time), v_amount,
    v_price, v_total, v_volume_unit, v_currency_code, v_comment, (p_log->>'tax_percentage')::numeric, (p_log->>'tax_amount')::numeric, COALESCE(p_log->>'price_volume_unit',v_volume_unit)
  )
  RETURNING * INTO v_log_row;

  INSERT INTO public.fuel_log_tank_entries (
    vessel_id, fuel_log_id, fuel_tank_id, amount_litres
  )
  SELECT v_vessel_id, v_log_row.id, entry.fuel_tank_id, entry.amount_litres
  FROM jsonb_to_recordset(p_entries) AS entry(fuel_tank_id UUID, amount_litres NUMERIC);

  RETURN to_jsonb(v_log_row);
END;
$function$;



CREATE OR REPLACE FUNCTION public.update_fuel_log_with_tank_entries(p_fuel_log_id uuid, p_vessel_id uuid, p_log_patch jsonb, p_entries jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

    p_log_patch := public._fuel_receipt_tax_patch(to_jsonb(existing), p_log_patch, p_entries);
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

  p_log_patch := public._fuel_receipt_tax_patch(to_jsonb(existing), p_log_patch, p_entries);

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
        tax_percentage = CASE WHEN p_log_patch ? 'tax_percentage' THEN (p_log_patch->>'tax_percentage')::numeric ELSE existing.tax_percentage END,
        tax_amount = CASE WHEN p_log_patch ? 'tax_amount' THEN (p_log_patch->>'tax_amount')::numeric ELSE existing.tax_amount END,
        price_volume_unit = COALESCE(p_log_patch->>'price_volume_unit', existing.price_volume_unit),
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
$function$;



CREATE OR REPLACE FUNCTION offline_private.fuel_value(vid uuid, f text, rid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE sid uuid; raw jsonb; fields jsonb; entries jsonb:='[]'; stable_id uuid;
BEGIN
 SELECT source_id INTO sid FROM offline_private.fuel_aliases WHERE feature=f AND record_id=rid AND vessel_id=vid;
 sid:=COALESCE(sid,rid);
 IF f='fuelLogs' THEN
 SELECT to_jsonb(r) INTO raw FROM public.fuel_logs r WHERE id=sid AND vessel_id=vid;
 -- Preserve the pre-migration revision of untaxed records and queued edits.
 IF raw->>'tax_percentage' IS NULL AND COALESCE((raw->>'tax_amount')::numeric,0)=0 THEN
   raw:=raw-ARRAY['tax_percentage','tax_amount'];
 END IF;
 SELECT jsonb_object_agg(k,raw->k) INTO fields FROM unnest(ARRAY['location_of_refueling','log_date','log_time','amount_of_fuel','price_per_gallon','total_price','volume_unit','price_volume_unit','currency_code','comment','effective_at','utc_offset_minutes']) k;
 IF raw ? 'tax_percentage' THEN fields:=fields||jsonb_build_object('tax_percentage',raw->'tax_percentage','tax_amount',raw->'tax_amount'); END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('fuel_tank_id',e.fuel_tank_id,'amount_litres',e.amount_litres) ORDER BY e.fuel_tank_id),'[]') INTO entries FROM public.fuel_log_tank_entries e WHERE fuel_log_id=sid AND vessel_id=vid;
 ELSIF f='fuelTransfers' THEN
 SELECT to_jsonb(r) INTO raw FROM public.fuel_transfers r WHERE id=sid AND vessel_id=vid;
 IF raw IS NOT NULL THEN raw:=COALESCE((SELECT e FROM jsonb_array_elements(public.get_fuel_transfers_with_snapshots(vid)->'transfers') e WHERE e->>'id'=sid::text),raw); END IF;
 SELECT jsonb_object_agg(k,raw->k) INTO fields FROM unnest(ARRAY['source_tank_id','destination_tank_id','amount_litres','transfer_date','transfer_time','location','notes','effective_at','utc_offset_minutes']) k;
 ELSIF f='fuelEntries' THEN
 SELECT public.get_fuel_inventory_operation(r.id) INTO raw FROM public.fuel_inventory_operations r WHERE id=sid AND vessel_id=vid AND operation_type IN('SOUNDING','CONSUMPTION','ADJUSTMENT');
 fields:=jsonb_build_object('operation_type',raw->'operation_type','effective_at',raw->'effective_at','utc_offset_minutes',raw->'utc_offset_minutes','fuel_tank_id',raw#>'{postings,0,fuel_tank_id}','amount_litres',CASE WHEN raw->>'operation_type'='CONSUMPTION' THEN -(raw#>>'{postings,0,amount_litres}')::numeric ELSE (raw#>>'{postings,0,amount_litres}')::numeric END,'location',COALESCE(raw#>>'{metadata,location}',''),'reason',COALESCE(raw#>>'{metadata,reason}',''),'notes',COALESCE(raw#>>'{metadata,notes}',''));
 ELSE RAISE EXCEPTION 'Unsupported fuel feature' USING ERRCODE='22023'; END IF;
 IF raw IS NULL THEN RETURN NULL; END IF;
 SELECT record_id INTO stable_id FROM offline_private.fuel_aliases WHERE feature=f AND source_id=sid AND vessel_id=vid;
 RETURN jsonb_build_object('id',COALESCE(stable_id,sid),'vessel_id',vid,'source_id',sid,'fields',fields,'entries',entries,'server',raw,'amendment_reason','');
END; $function$;



CREATE OR REPLACE FUNCTION public.sync_web_offline_fuel(p_vessel_id uuid, p_device_id text, p_operation jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE f text:=p_operation->>'feature'; kind text:=p_operation->>'kind'; v jsonb:=p_operation->'value';
 oid uuid; rid uuid; sid uuid; old jsonb; result jsonb; fields jsonb; allowed text[];
 receipt offline_private.record_receipts%ROWTYPE;
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 IF jsonb_typeof(p_operation)<>'object' OR octet_length(p_operation::text)>260000 OR f IS NULL OR f NOT IN('fuelLogs','fuelTransfers','fuelEntries') OR kind IS NULL OR kind NOT IN('create','update') OR jsonb_typeof(v)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','feature','recordId','kind','value','baseRevision')) THEN RAISE EXCEPTION 'Invalid fuel operation' USING ERRCODE='22023'; END IF;
 oid:=(p_operation->>'id')::uuid;rid:=(p_operation->>'recordId')::uuid; fields:=v->'fields';
 allowed:=CASE f WHEN 'fuelLogs' THEN ARRAY['location_of_refueling','log_date','log_time','amount_of_fuel','price_per_gallon','total_price','tax_percentage','tax_amount','volume_unit','price_volume_unit','currency_code','comment','effective_at','utc_offset_minutes'] WHEN 'fuelTransfers' THEN ARRAY['source_tank_id','destination_tank_id','amount_litres','transfer_date','transfer_time','location','notes','effective_at','utc_offset_minutes'] ELSE ARRAY['operation_type','effective_at','utc_offset_minutes','fuel_tank_id','amount_litres','location','reason','notes'] END;
 IF oid IS NULL OR rid IS NULL OR (v->>'id')::uuid IS DISTINCT FROM rid OR (v->>'vessel_id')::uuid IS DISTINCT FROM p_vessel_id OR jsonb_typeof(fields) IS DISTINCT FROM 'object' OR jsonb_typeof(v->'entries') IS DISTINCT FROM 'array' OR jsonb_typeof(v->'server') IS DISTINCT FROM 'object' OR jsonb_typeof(v->'amendment_reason') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid fuel value' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','vessel_id','source_id','fields','entries','server','amendment_reason')) OR EXISTS(SELECT 1 FROM jsonb_object_keys(fields) k WHERE NOT k=ANY(allowed)) OR NOT fields ?& array_remove(array_remove(allowed,'tax_percentage'),'tax_amount') OR (f<>'fuelLogs' AND v->'entries'<>'[]'::jsonb) THEN RAISE EXCEPTION 'Unexpected fields' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'entries') e WHERE jsonb_typeof(e)<>'object') THEN RAISE EXCEPTION 'Invalid allocation' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'entries') e CROSS JOIN LATERAL jsonb_object_keys(e) k WHERE k NOT IN('fuel_tank_id','amount_litres')) THEN RAISE EXCEPTION 'Invalid allocation fields' USING ERRCODE='22023'; END IF;
 IF (kind='update' OR (f='fuelEntries' AND fields->>'operation_type'='ADJUSTMENT')) AND NOT public.current_user_can_manage_vessel(p_vessel_id) THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||oid::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_vessel_id::text||f||rid::text,0));
 old:=offline_private.fuel_value(p_vessel_id,f,rid);
 SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=oid;
 IF FOUND THEN
 IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>f THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
 IF old IS NULL THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 ELSE
 IF kind='create' THEN
 IF old IS NOT NULL OR p_operation->>'baseRevision' IS NOT NULL OR v->>'source_id' IS NOT NULL THEN RETURN jsonb_build_object('status','conflict'); END IF;
 ELSE
 IF old IS NULL THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 IF old->>'source_id' IS DISTINCT FROM v->>'source_id' OR md5(old::text) IS DISTINCT FROM p_operation->>'baseRevision' OR old#>>'{server,voided_at}' IS NOT NULL OR old#>>'{server,void_kind}' IS NOT NULL THEN RETURN jsonb_build_object('status','conflict'); END IF;
 END IF;
 BEGIN
 sid:=(old->>'source_id')::uuid;
 IF f='fuelLogs' THEN
 IF kind='create' THEN
 result:=to_jsonb(public.create_fuel_receipt_with_tanks(fields||jsonb_build_object('vessel_id',p_vessel_id,'client_request_id',oid),v->'entries','[]'::jsonb,NULL));
 ELSE
 IF fields->>'effective_at' IS NULL AND old#>>'{fields,effective_at}' IS NULL THEN fields:=fields-ARRAY['effective_at','utc_offset_minutes','log_date','log_time']; END IF;
 result:=to_jsonb(public.update_fuel_log_with_tank_entries(sid,p_vessel_id,fields||jsonb_build_object('client_request_id',oid,'expected_revision',old#>'{server,inventory_revision}','amendment_reason',v->>'amendment_reason'),v->'entries'));
 END IF; sid:=(result->>'id')::uuid;
 ELSIF f='fuelTransfers' THEN
 IF kind='create' THEN result:=public.record_fuel_transfer(fields||jsonb_build_object('vessel_id',p_vessel_id),oid);
 ELSE result:=public.amend_fuel_transfer(sid,(old#>>'{server,inventory_revision}')::integer,fields||jsonb_build_object('vessel_id',p_vessel_id),v->>'amendment_reason',oid); END IF;
 sid:=COALESCE(result#>>'{transfer,id}',result->>'id')::uuid;
 ELSE
 IF kind='create' THEN result:=public.record_fuel_inventory_entry(p_vessel_id,fields->>'operation_type',(fields->>'effective_at')::timestamptz,(fields->>'utc_offset_minutes')::smallint,(fields->>'fuel_tank_id')::uuid,(fields->>'amount_litres')::numeric,fields->>'location',fields->>'reason',fields->>'notes',oid);
 ELSE
 IF fields->>'operation_type' IS DISTINCT FROM old#>>'{fields,operation_type}' OR fields->>'fuel_tank_id' IS DISTINCT FROM old#>>'{fields,fuel_tank_id}' THEN RAISE insufficient_privilege; END IF;
 result:=public.amend_fuel_inventory_entry(sid,(old#>>'{server,revision_no}')::integer,(fields->>'effective_at')::timestamptz,(fields->>'utc_offset_minutes')::smallint,(fields->>'amount_litres')::numeric,fields->>'location',fields->>'reason',fields->>'notes',v->>'amendment_reason',oid);
 END IF; sid:=(result->>'id')::uuid;
 END IF;
 IF sid IS NULL THEN RAISE EXCEPTION 'Missing fuel result'; END IF;
 INSERT INTO offline_private.fuel_aliases(feature,vessel_id,record_id,source_id) VALUES(f,p_vessel_id,rid,sid) ON CONFLICT(feature,record_id) DO UPDATE SET source_id=EXCLUDED.source_id WHERE fuel_aliases.vessel_id=EXCLUDED.vessel_id;
 INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash) VALUES(auth.uid(),oid,p_vessel_id,p_device_id,f,rid,md5(p_operation::text));
 EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('status','forbidden');
 WHEN unique_violation OR serialization_failure OR check_violation OR raise_exception THEN RETURN jsonb_build_object('status','conflict'); END;
 old:=offline_private.fuel_value(p_vessel_id,f,rid);
 END IF;
 RETURN jsonb_build_object('status','applied','operationId',oid,'recordId',rid,'value',old,'revision',md5(old::text));
END; $function$;

