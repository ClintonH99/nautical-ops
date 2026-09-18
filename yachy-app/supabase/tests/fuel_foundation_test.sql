\set ON_ERROR_STOP on

-- This test is intended for the disposable schema-replay database after the
-- production baseline. Re-running the migration also verifies its idempotency.
\ir ../migrations/20260918150000_ADD_VESSEL_FUEL_FOUNDATION.sql

BEGIN;

INSERT INTO public.vessels (id, name, invite_code, invite_expiry, is_solo)
VALUES
  ('f1000000-0000-0000-0000-000000000001', 'Fuel Test Vessel', 'FUELTEST001', now() + interval '1 year', FALSE),
  ('f1000000-0000-0000-0000-000000000002', 'Other Fuel Vessel', 'FUELTEST002', now() + interval '1 year', FALSE);

INSERT INTO public.users (id, email, name, position, department, vessel_id, role)
VALUES
  ('f2000000-0000-0000-0000-000000000001', 'captain@fuel.test', 'Captain Fuel', 'Captain', 'BRIDGE', 'f1000000-0000-0000-0000-000000000001', 'CAPTAIN_MOV'),
  ('f2000000-0000-0000-0000-000000000002', 'hod@fuel.test', 'HOD Fuel', 'Chief Engineer', 'ENGINEERING', 'f1000000-0000-0000-0000-000000000001', 'HOD'),
  ('f2000000-0000-0000-0000-000000000003', 'crew@fuel.test', 'Crew Fuel', 'Deckhand', 'EXTERIOR', 'f1000000-0000-0000-0000-000000000001', 'CREW'),
  ('f2000000-0000-0000-0000-000000000004', 'other@fuel.test', 'Other Fuel', 'Deckhand', 'EXTERIOR', 'f1000000-0000-0000-0000-000000000002', 'CREW');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000001', false);

SELECT public.save_vessel_fuel_setup(
  'f1000000-0000-0000-0000-000000000001',
  'LITRES',
  '[
    {"name":"Forward Starboard","location":"Engine room","description":"Main tank","capacity_litres":1000},
    {"name":"Day Tank","capacity_litres":1000},
    {"name":"Reserve Tank","capacity_litres":1000}
  ]'::jsonb
);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.fuel_tanks) <> 3 THEN
    RAISE EXCEPTION 'Captain setup save did not persist all tanks';
  END IF;
  IF (SELECT volume_unit FROM public.vessel_fuel_settings WHERE vessel_id = 'f1000000-0000-0000-0000-000000000001') <> 'LITRES' THEN
    RAISE EXCEPTION 'Captain setup save did not persist the display unit';
  END IF;
END;
$$;

-- Retained tank names can be swapped without replacing their stable IDs. The
-- save function must avoid transient unique-index collisions during the
-- multi-row rename and preserve the complete requested setup atomically.
DO $$
DECLARE
  forward_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Forward Starboard');
  day_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Day Tank');
  reserve_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Reserve Tank');
BEGIN
  PERFORM public.save_vessel_fuel_setup(
    'f1000000-0000-0000-0000-000000000001',
    'LITRES',
    jsonb_build_array(
      jsonb_build_object('id', forward_id, 'name', 'Day Tank', 'capacity_litres', 1000),
      jsonb_build_object('id', day_id, 'name', 'Forward Starboard', 'capacity_litres', 1000),
      jsonb_build_object('id', reserve_id, 'name', 'Reserve Tank', 'capacity_litres', 1000)
    )
  );

  IF (SELECT name FROM public.fuel_tanks WHERE id = forward_id) <> 'Day Tank'
    OR (SELECT name FROM public.fuel_tanks WHERE id = day_id) <> 'Forward Starboard' THEN
    RAISE EXCEPTION 'Fuel setup did not swap retained tank names by stable ID';
  END IF;

  PERFORM public.save_vessel_fuel_setup(
    'f1000000-0000-0000-0000-000000000001',
    'LITRES',
    jsonb_build_array(
      jsonb_build_object('id', forward_id, 'name', 'Forward Starboard', 'capacity_litres', 1000),
      jsonb_build_object('id', day_id, 'name', 'Day Tank', 'capacity_litres', 1000),
      jsonb_build_object('id', reserve_id, 'name', 'Reserve Tank', 'capacity_litres', 1000)
    )
  );

  IF (SELECT name FROM public.fuel_tanks WHERE id = forward_id) <> 'Forward Starboard'
    OR (SELECT name FROM public.fuel_tanks WHERE id = day_id) <> 'Day Tank' THEN
    RAISE EXCEPTION 'Fuel setup did not restore swapped tank names by stable ID';
  END IF;
END;
$$;

-- Setup/tank creator UUIDs are derived by the server and immutable. Exercise a
-- forged insert as well as direct rewrites through the otherwise-valid policies.
DO $$
DECLARE
  probe_tank_id UUID;
BEGIN
  UPDATE public.vessel_fuel_settings
  SET created_by = 'f2000000-0000-0000-0000-000000000002'
  WHERE vessel_id = 'f1000000-0000-0000-0000-000000000001';

  UPDATE public.fuel_tanks
  SET created_by = 'f2000000-0000-0000-0000-000000000002'
  WHERE vessel_id = 'f1000000-0000-0000-0000-000000000001';

  INSERT INTO public.fuel_tanks (
    vessel_id, name, capacity_litres, created_by
  ) VALUES (
    'f1000000-0000-0000-0000-000000000001', 'Actor Probe', 100,
    'f2000000-0000-0000-0000-000000000002'
  )
  RETURNING id INTO probe_tank_id;

  IF EXISTS (
    SELECT 1 FROM public.vessel_fuel_settings
    WHERE vessel_id = 'f1000000-0000-0000-0000-000000000001'
      AND created_by IS DISTINCT FROM 'f2000000-0000-0000-0000-000000000001'
  ) OR EXISTS (
    SELECT 1 FROM public.fuel_tanks
    WHERE vessel_id = 'f1000000-0000-0000-0000-000000000001'
      AND created_by IS DISTINCT FROM 'f2000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Fuel setup trusted or rewrote a client-supplied creator';
  END IF;

  BEGIN
    UPDATE public.vessel_fuel_settings
    SET vessel_id = 'f1000000-0000-0000-0000-000000000002'
    WHERE vessel_id = 'f1000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Fuel settings moved between vessels';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Fuel setup records cannot be moved between vessels' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.fuel_tanks
    SET vessel_id = 'f1000000-0000-0000-0000-000000000002'
    WHERE id = probe_tank_id;
    RAISE EXCEPTION 'Fuel tank moved between vessels';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Fuel setup records cannot be moved between vessels' THEN RAISE; END IF;
  END;

  DELETE FROM public.fuel_tanks WHERE id = probe_tank_id;
END;
$$;

-- Old direct writes keep working and receive only safe defaults for new fields.
INSERT INTO public.fuel_logs (
  vessel_id, log_date, log_time, amount_of_fuel, price_per_gallon, total_price
) VALUES (
  'f1000000-0000-0000-0000-000000000001', '2026-09-18', '09:00', 20, 1, 20
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.fuel_logs
    WHERE vessel_id = 'f1000000-0000-0000-0000-000000000001'
      AND volume_unit IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.fuel_logs
    WHERE vessel_id = 'f1000000-0000-0000-0000-000000000001'
      AND currency_code = 'USD' AND comment = ''
  ) THEN
    RAISE EXCEPTION 'Legacy fuel log compatibility defaults are incorrect';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000003', false);

-- Crew can read the shared configuration, but cannot edit it.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.fuel_tanks) <> 3 THEN
    RAISE EXCEPTION 'Crew could not read vessel fuel tanks';
  END IF;
  BEGIN
    PERFORM public.save_vessel_fuel_setup(
      'f1000000-0000-0000-0000-000000000001',
      'US_GALLONS',
      '[]'::jsonb
    );
    RAISE EXCEPTION 'Crew changed fuel setup';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Only an HOD or Captain/MOV can save vessel fuel setup' THEN RAISE; END IF;
  END;
END;
$$;

-- Active crew may create an operational log and its allocations atomically.
SELECT public.create_fuel_log_with_tank_entries(
  jsonb_build_object(
    'vessel_id', 'f1000000-0000-0000-0000-000000000001',
    'location_of_refueling', 'Monaco',
    'log_date', '2026-09-18',
    'log_time', '10:30',
    'amount_of_fuel', 500,
    'price_per_gallon', 1.08,
    'total_price', 540,
    'created_by_name', 'Forged Captain Name',
    'volume_unit', 'LITRES',
    'currency_code', 'EUR',
    'comment', 'Allocated to main tank'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE name = 'Forward Starboard'),
      'amount_litres', 500
    )
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.fuel_logs
    WHERE vessel_id = 'f1000000-0000-0000-0000-000000000001'
      AND created_by = 'f2000000-0000-0000-0000-000000000003'
      AND created_by_name = 'Crew Fuel'
      AND volume_unit = 'LITRES'
  ) THEN
    RAISE EXCEPTION 'Fuel log actor attribution was not derived from the authenticated profile';
  END IF;

  BEGIN
    INSERT INTO public.fuel_log_tank_entries (
      vessel_id, fuel_log_id, fuel_tank_id, amount_litres
    ) VALUES (
      'f1000000-0000-0000-0000-000000000001',
      (SELECT id FROM public.fuel_logs WHERE volume_unit = 'LITRES' LIMIT 1),
      (SELECT id FROM public.fuel_tanks WHERE name = 'Day Tank'),
      1
    );
    RAISE EXCEPTION 'Authenticated client bypassed the atomic allocation RPC';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

-- A second refuel cannot push the recorded tank volume above its configured
-- capacity. The failed RPC must roll its parent row back as well.
DO $$
BEGIN
  BEGIN
    PERFORM public.create_fuel_log_with_tank_entries(
      jsonb_build_object(
        'vessel_id', 'f1000000-0000-0000-0000-000000000001',
        'log_date', '2026-09-18',
        'log_time', '10:45',
        'amount_of_fuel', 501,
        'price_per_gallon', 1,
        'total_price', 501,
        'volume_unit', 'LITRES'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE name = 'Forward Starboard'),
          'amount_litres', 501
        )
      )
    );
    RAISE EXCEPTION 'Refuel allocation exceeded tank capacity';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Fuel log allocation would exceed tank capacity' THEN RAISE; END IF;
  END;

  IF (SELECT count(*) FROM public.fuel_logs WHERE volume_unit = 'LITRES') <> 1 THEN
    RAISE EXCEPTION 'Failed over-capacity refuel left a parent fuel log behind';
  END IF;
END;
$$;

-- Three-decimal US-gallon values must round-trip through the legacy parent
-- column without drifting away from their canonical litre allocations. The
-- update RPC always rewrites the parent amount, so this covers both creation
-- and a later edit of the same record.
DO $$
DECLARE
  reserve_tank_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Reserve Tank');
  gallon_log JSONB;
  gallon_log_id UUID;
  allocated_litres NUMERIC(14, 3) := round((1.235 * 3.785411784)::NUMERIC, 3);
BEGIN
  gallon_log := public.create_fuel_log_with_tank_entries(
    jsonb_build_object(
      'vessel_id', 'f1000000-0000-0000-0000-000000000001',
      'log_date', '2026-09-18',
      'log_time', '10:50',
      'amount_of_fuel', 1.235,
      'price_per_gallon', 2.3456,
      'total_price', 2.90,
      'volume_unit', 'US_GALLONS',
      'currency_code', 'USD',
      'comment', 'Three-decimal gallon regression'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'fuel_tank_id', reserve_tank_id,
        'amount_litres', allocated_litres
      )
    )
  );
  gallon_log_id := (gallon_log ->> 'id')::UUID;

  IF (SELECT amount_of_fuel FROM public.fuel_logs WHERE id = gallon_log_id) <> 1.235 THEN
    RAISE EXCEPTION 'Fuel-log parent rounded away a three-decimal gallon amount';
  END IF;

  PERFORM public.update_fuel_log_with_tank_entries(
    gallon_log_id,
    'f1000000-0000-0000-0000-000000000001',
    jsonb_build_object('comment', 'Three-decimal gallon edit passed'),
    jsonb_build_array(
      jsonb_build_object(
        'fuel_tank_id', reserve_tank_id,
        'amount_litres', allocated_litres
      )
    )
  );

  IF (SELECT comment FROM public.fuel_logs WHERE id = gallon_log_id)
    <> 'Three-decimal gallon edit passed' THEN
    RAISE EXCEPTION 'Three-decimal gallon log could not be edited after creation';
  END IF;
END;
$$;

-- Legacy parent updates remain valid for unallocated rows, while tank-aware
-- parent totals cannot be edited independently of their child allocations.
DO $$
DECLARE
  tank_aware_log_id UUID := (
    SELECT id FROM public.fuel_logs WHERE volume_unit = 'LITRES' LIMIT 1
  );
  legacy_log_id UUID := (
    SELECT id FROM public.fuel_logs WHERE volume_unit IS NULL LIMIT 1
  );
BEGIN
  BEGIN
    UPDATE public.fuel_logs
    SET amount_of_fuel = 450
    WHERE id = tank_aware_log_id;
    RAISE EXCEPTION 'Direct update desynchronized a tank-aware fuel log';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Tank-aware fuel log parent and allocations must remain synchronized' THEN
      RAISE;
    END IF;
  END;

  UPDATE public.fuel_logs
  SET comment = 'Metadata-only direct update remains safe'
  WHERE id = tank_aware_log_id;

  UPDATE public.fuel_logs
  SET amount_of_fuel = 25
  WHERE id = legacy_log_id;

  IF (SELECT amount_of_fuel FROM public.fuel_logs WHERE id = legacy_log_id) <> 25
    OR (SELECT amount_of_fuel FROM public.fuel_logs WHERE id = tank_aware_log_id) <> 500 THEN
    RAISE EXCEPTION 'Fuel-log parent compatibility or synchronization guard is incorrect';
  END IF;
END;
$$;

DO $$
DECLARE
  source_tank UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Forward Starboard');
  destination_tank UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Day Tank');
  downstream_tank UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Reserve Tank');
  upstream_transfer_id UUID;
  downstream_transfer_id UUID;
  tank_aware_log_id UUID := (
    SELECT id FROM public.fuel_logs WHERE volume_unit = 'LITRES' LIMIT 1
  );
BEGIN
  BEGIN
    INSERT INTO public.fuel_transfers (
      vessel_id, source_tank_id, destination_tank_id, amount_litres, transfer_date, transfer_time
    ) VALUES (
      'f1000000-0000-0000-0000-000000000001', source_tank, destination_tank, 501, '2026-09-18', '11:00'
    );
    RAISE EXCEPTION 'Transfer exceeded recorded source balance';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Transfer amount exceeds the recorded source tank balance' THEN RAISE; END IF;
  END;

  INSERT INTO public.fuel_transfers (
    vessel_id, source_tank_id, destination_tank_id, amount_litres, transfer_date, transfer_time,
    created_by
  ) VALUES (
    'f1000000-0000-0000-0000-000000000001', source_tank, destination_tank, 400,
    '2026-09-18', '11:00', 'f2000000-0000-0000-0000-000000000002'
  )
  RETURNING id INTO upstream_transfer_id;

  IF (SELECT created_by FROM public.fuel_transfers WHERE id = upstream_transfer_id)
    <> 'f2000000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'Fuel transfer insert trusted a client-supplied creator';
  END IF;

  UPDATE public.fuel_transfers
  SET
    created_by = 'f2000000-0000-0000-0000-000000000002',
    notes = 'Creator must remain immutable'
  WHERE id = upstream_transfer_id;

  IF (SELECT created_by FROM public.fuel_transfers WHERE id = upstream_transfer_id)
    <> 'f2000000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'Fuel transfer update rewrote its immutable creator';
  END IF;

  INSERT INTO public.fuel_transfers (
    vessel_id, source_tank_id, destination_tank_id, amount_litres, transfer_date, transfer_time
  ) VALUES (
    'f1000000-0000-0000-0000-000000000001', destination_tank, downstream_tank, 300,
    '2026-09-18', '12:00'
  )
  RETURNING id INTO downstream_transfer_id;

  BEGIN
    UPDATE public.fuel_transfers
    SET amount_litres = 550
    WHERE id = upstream_transfer_id;
    RAISE EXCEPTION 'Transfer update exceeded recorded source balance';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Transfer amount exceeds the recorded source tank balance' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.fuel_transfers
    SET amount_litres = 200
    WHERE id = upstream_transfer_id;
    RAISE EXCEPTION 'Transfer update left a downstream tank negative';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Transfer change would leave a tank recorded balance negative' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM public.fuel_transfers
    WHERE id = upstream_transfer_id;
    RAISE EXCEPTION 'Transfer delete left a downstream tank negative';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Transfer change would leave a tank recorded balance negative' THEN RAISE; END IF;
  END;

  UPDATE public.fuel_transfers
  SET amount_litres = 350
  WHERE id = upstream_transfer_id;

  PERFORM public.update_fuel_log_with_tank_entries(
    tank_aware_log_id,
    'f1000000-0000-0000-0000-000000000001',
    jsonb_build_object('amount_of_fuel', 400),
    jsonb_build_array(
      jsonb_build_object('fuel_tank_id', source_tank, 'amount_litres', 400)
    )
  );

  IF (SELECT amount_of_fuel FROM public.fuel_logs WHERE id = tank_aware_log_id) <> 400
    OR (SELECT amount_litres FROM public.fuel_log_tank_entries WHERE fuel_log_id = tank_aware_log_id) <> 400 THEN
    RAISE EXCEPTION 'Valid allocation reduction did not persist atomically';
  END IF;

  BEGIN
    PERFORM public.update_fuel_log_with_tank_entries(
      tank_aware_log_id,
      'f1000000-0000-0000-0000-000000000001',
      jsonb_build_object('amount_of_fuel', 1400),
      jsonb_build_array(
        jsonb_build_object('fuel_tank_id', source_tank, 'amount_litres', 1400)
      )
    );
    RAISE EXCEPTION 'Allocation update exceeded tank capacity';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Fuel log allocation would exceed tank capacity' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.update_fuel_log_with_tank_entries(
      tank_aware_log_id,
      'f1000000-0000-0000-0000-000000000001',
      jsonb_build_object('amount_of_fuel', 300),
      jsonb_build_array(
        jsonb_build_object('fuel_tank_id', source_tank, 'amount_litres', 300)
      )
    );
    RAISE EXCEPTION 'Allocation update left its tank negative';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Fuel log allocation change would leave a tank recorded balance negative' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    DELETE FROM public.fuel_logs
    WHERE id = tank_aware_log_id;
    RAISE EXCEPTION 'Allocation delete left its tank negative';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Fuel log allocation change would leave a tank recorded balance negative' THEN
      RAISE;
    END IF;
  END;

  DELETE FROM public.fuel_transfers
  WHERE id = downstream_transfer_id;

  PERFORM public.create_fuel_log_with_tank_entries(
    jsonb_build_object(
      'vessel_id', 'f1000000-0000-0000-0000-000000000001',
      'log_date', '2026-09-18',
      'log_time', '13:00',
      'amount_of_fuel', 650,
      'price_per_gallon', 1,
      'total_price', 650,
      'volume_unit', 'LITRES'
    ),
    jsonb_build_array(
      jsonb_build_object('fuel_tank_id', source_tank, 'amount_litres', 650)
    )
  );

  BEGIN
    DELETE FROM public.fuel_transfers
    WHERE id = upstream_transfer_id;
    RAISE EXCEPTION 'Transfer delete pushed its old source above capacity';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Transfer change would exceed a tank capacity' THEN RAISE; END IF;
  END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000004', false);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.fuel_tanks)
    OR EXISTS (SELECT 1 FROM public.fuel_transfers) THEN
    RAISE EXCEPTION 'Other vessel member could read fuel records';
  END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE public.fuel_tanks
    SET capacity_litres = 699
    WHERE name = 'Forward Starboard';
    RAISE EXCEPTION 'Tank capacity was reduced below its recorded balance';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Fuel tank capacity cannot be lower than its recorded balance' THEN RAISE; END IF;
  END;

  UPDATE public.fuel_tanks
  SET capacity_litres = 700
  WHERE name = 'Forward Starboard';

  IF (SELECT capacity_litres FROM public.fuel_tanks WHERE name = 'Forward Starboard') <> 700 THEN
    RAISE EXCEPTION 'Tank capacity equal to its recorded balance was rejected';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conname IN (
        'vessel_fuel_settings_created_by_fkey',
        'fuel_tanks_created_by_fkey',
        'fuel_transfers_created_by_fkey'
      )
      AND confrelid = 'public.users'::regclass
      AND confdeltype = 'n'
  ) <> 3 THEN
    RAISE EXCEPTION 'Fuel creator FKs do not use public.users ON DELETE SET NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid IN (
        'public.vessel_fuel_settings'::regclass,
        'public.fuel_tanks'::regclass,
        'public.fuel_transfers'::regclass
      )
      AND attname = 'created_by'
      AND NOT attisdropped
      AND attnotnull
  ) THEN
    RAISE EXCEPTION 'Fuel creators must be nullable for profile deletion';
  END IF;
END;
$$;

-- FK cleanup may clear the UUID only after its profile is actually gone. The
-- actor triggers must permit that system transition while retaining audit names.
DELETE FROM public.users
WHERE id = 'f2000000-0000-0000-0000-000000000003';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.fuel_logs
    WHERE volume_unit = 'LITRES' AND created_by IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.fuel_transfers WHERE created_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Profile deletion did not clear fuel creator foreign keys';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.fuel_logs
    WHERE volume_unit = 'LITRES'
      AND created_by IS NULL
      AND created_by_name = 'Crew Fuel'
  ) THEN
    RAISE EXCEPTION 'Fuel log profile deletion discarded its historical actor name';
  END IF;
END;
$$;

DELETE FROM public.users
WHERE id = 'f2000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.vessel_fuel_settings WHERE created_by IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.fuel_tanks WHERE created_by IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.fuel_logs
    WHERE volume_unit IS NULL AND created_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Captain profile deletion did not clear retained fuel creator UUIDs';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'fuel foundation tests passed' AS result;
