\set ON_ERROR_STOP on

-- Run after the production baseline and all ordered migrations. Reapplying the
-- feature migration also verifies that its schema and RPC are idempotent.
\ir ../migrations/20260921130000_ADD_INLINE_FUEL_RECEIPT_TANKS.sql
\ir ../migrations/20260921170000_MAKE_FUEL_RECEIPTS_STANDALONE.sql

BEGIN;

INSERT INTO public.vessels (id, name, invite_code, invite_expiry, is_solo)
VALUES (
  'b1000000-0000-0000-0000-000000000001',
  'Inline Fuel Receipt Test',
  'INLINE0001',
  now() + interval '1 year',
  FALSE
);

INSERT INTO public.users (id, email, name, position, department, vessel_id, role)
VALUES
  (
    'b2000000-0000-0000-0000-000000000001',
    'captain@inline-fuel.test',
    'Inline Fuel Captain',
    'Captain',
    'BRIDGE',
    'b1000000-0000-0000-0000-000000000001',
    'CAPTAIN_MOV'
  ),
  (
    'b2000000-0000-0000-0000-000000000002',
    'crew@inline-fuel.test',
    'Inline Fuel Crew',
    'Deckhand',
    'EXTERIOR',
    'b1000000-0000-0000-0000-000000000001',
    'CREW'
  );

SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'b2000000-0000-0000-0000-000000000001',
  false
);

SELECT public.save_vessel_fuel_setup(
  'b1000000-0000-0000-0000-000000000001',
  'LITRES',
  '[{"name":"Existing Port Tank","capacity_litres":1000}]'::JSONB,
  0,
  'b4000000-0000-4000-8000-000000000001'
);

-- Before activation, the same RPC must atomically add the tank and retain a
-- report-only receipt result for exact offline retries.
DO $$
DECLARE
  receipt_time TIMESTAMPTZ := clock_timestamp();
  receipt_payload JSONB;
  created JSONB;
  replayed JSONB;
BEGIN
  receipt_payload := jsonb_build_object(
    'vessel_id', 'b1000000-0000-0000-0000-000000000001',
    'location_of_refueling', 'Pre-activation quay',
    'log_date', (receipt_time AT TIME ZONE 'UTC')::DATE,
    'log_time', to_char(receipt_time AT TIME ZONE 'UTC', 'HH24:MI:SS.MS'),
    'amount_of_fuel', 25,
    'price_per_gallon', 2,
    'total_price', 50,
    'volume_unit', 'LITRES',
    'price_volume_unit', 'LITRES',
    'currency_code', 'EUR',
    'comment', 'Report-only inline tank receipt',
    'effective_at', receipt_time,
    'utc_offset_minutes', 0,
    'client_request_id', 'b4000000-0000-4000-8000-000000000010'
  );

  created := public.create_fuel_receipt_with_tanks(
    receipt_payload,
    '[{"fuel_tank_id":"b3000000-0000-4000-8000-000000000010","amount_litres":25}]'::JSONB,
    '[{"id":"b3000000-0000-4000-8000-000000000010","name":"Pre-activation Day Tank","capacity_litres":200,"opening_litres":0}]'::JSONB,
    1
  );
  IF created ->> 'current_inventory_operation_id' IS NOT NULL THEN
    RAISE EXCEPTION 'Pre-activation receipt unexpectedly posted to the inventory ledger';
  END IF;
  replayed := public.create_fuel_receipt_with_tanks(
    receipt_payload,
    '[{"fuel_tank_id":"b3000000-0000-4000-8000-000000000010","amount_litres":25}]'::JSONB,
    '[{"id":"b3000000-0000-4000-8000-000000000010","name":"Pre-activation Day Tank","capacity_litres":200,"opening_litres":0}]'::JSONB,
    1
  );
  IF replayed ->> 'id' IS DISTINCT FROM created ->> 'id' THEN
    RAISE EXCEPTION 'Pre-activation inline receipt retry was not idempotent';
  END IF;

  BEGIN
    PERFORM public.create_fuel_receipt_with_tanks(
      (receipt_payload - 'volume_unit' - 'price_volume_unit')
        || jsonb_build_object(
          'client_request_id', 'b4000000-0000-4000-8000-000000000011'
        ),
      '[{"fuel_tank_id":"b3000000-0000-4000-8000-000000000010","amount_litres":25}]'::JSONB,
      '[]'::JSONB,
      NULL
    );
    RAISE EXCEPTION 'Unitless inline receipt unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'Fuel quantity and price units must be LITRES or US_GALLONS' THEN
      RAISE;
    END IF;
  END;
END;
$$;

SELECT public.activate_vessel_fuel_inventory(
  'b1000000-0000-0000-0000-000000000001',
  clock_timestamp(),
  0::SMALLINT,
  jsonb_build_array(jsonb_build_object(
    'fuel_tank_id', (
      SELECT id FROM public.fuel_tanks
      WHERE vessel_id = 'b1000000-0000-0000-0000-000000000001'
        AND name = 'Existing Port Tank'
    ),
    'amount_litres', 100
  ), jsonb_build_object(
    'fuel_tank_id', 'b3000000-0000-4000-8000-000000000010',
    'amount_litres', 25
  )),
  'Verified opening level',
  'b4000000-0000-4000-8000-000000000002'
);

DO $$
DECLARE
  receipt_time TIMESTAMPTZ := clock_timestamp();
  receipt_payload JSONB;
  existing_tank_id UUID := (
    SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'b1000000-0000-0000-0000-000000000001'
      AND name = 'Existing Port Tank'
  );
  entries JSONB := jsonb_build_array(
    jsonb_build_object(
      'fuel_tank_id', existing_tank_id,
      'amount_litres', 950
    ),
    jsonb_build_object(
      'fuel_tank_id', 'b3000000-0000-4000-8000-000000000002',
      'amount_litres', 100
    )
  );
  new_tanks JSONB := jsonb_build_array(
    jsonb_build_object(
      'id', 'b3000000-0000-4000-8000-000000000002',
      'name', 'Forward Starboard Tank',
      'location', 'Forward machinery space',
      'description', 'Inline receipt test tank',
      'capacity_litres', 500,
      'opening_litres', 50
    )
  );
  created JSONB;
  replayed JSONB;
  receipt_id UUID;
  before_operation_count BIGINT;
BEGIN
  receipt_payload := jsonb_build_object(
    'vessel_id', 'b1000000-0000-0000-0000-000000000001',
    'location_of_refueling', 'Port Test',
    'log_date', (receipt_time AT TIME ZONE 'UTC')::DATE,
    'log_time', to_char(receipt_time AT TIME ZONE 'UTC', 'HH24:MI:SS.MS'),
    'amount_of_fuel', 1050,
    'price_per_gallon', 4,
    'total_price', 1109.52,
    'volume_unit', 'LITRES',
    'price_volume_unit', 'US_GALLONS',
    'currency_code', 'USD',
    'comment', 'Fuel sample retained',
    'effective_at', receipt_time,
    'utc_offset_minutes', 0,
    'client_request_id', 'b4000000-0000-4000-8000-000000000003'
  );

  created := public.create_fuel_receipt_with_tanks(
    receipt_payload, entries, new_tanks, 2
  );
  receipt_id := (created ->> 'id')::UUID;
  IF created ->> 'price_volume_unit' IS DISTINCT FROM 'US_GALLONS' THEN
    RAISE EXCEPTION 'Independent price unit was not retained';
  END IF;
  IF created ->> 'current_inventory_operation_id' IS NOT NULL THEN
    RAISE EXCEPTION 'Standalone receipt unexpectedly changed calculated inventory';
  END IF;
  IF (SELECT setup_revision FROM public.vessel_fuel_settings
      WHERE vessel_id = 'b1000000-0000-0000-0000-000000000001') IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'Inline tank creation did not advance setup revision';
  END IF;
  IF (SELECT count(*) FROM public.fuel_log_tank_entries
      WHERE fuel_log_id = receipt_id) <> 2 THEN
    RAISE EXCEPTION 'Inline receipt did not retain every tank allocation';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.fuel_inventory_operations
    WHERE source_fuel_log_id = receipt_id
  ) THEN
    RAISE EXCEPTION 'Standalone receipt created an inventory operation';
  END IF;

  SELECT count(*) INTO before_operation_count
  FROM public.fuel_inventory_operations
  WHERE vessel_id = 'b1000000-0000-0000-0000-000000000001';
  replayed := public.create_fuel_receipt_with_tanks(
    receipt_payload, entries, new_tanks, 2
  );
  IF replayed ->> 'id' IS DISTINCT FROM receipt_id::TEXT OR (
    SELECT count(*) FROM public.fuel_inventory_operations
    WHERE vessel_id = 'b1000000-0000-0000-0000-000000000001'
  ) <> before_operation_count THEN
    RAISE EXCEPTION 'Exact inline receipt retry was not idempotent';
  END IF;

  BEGIN
    PERFORM public.create_fuel_receipt_with_tanks(
      receipt_payload || jsonb_build_object(
        'client_request_id', 'b4000000-0000-4000-8000-000000000004',
        'amount_of_fuel', 101,
        'total_price', 106.73
      ),
      jsonb_build_array(jsonb_build_object(
        'fuel_tank_id', 'b3000000-0000-4000-8000-000000000003',
        'amount_litres', 101
      )),
      jsonb_build_array(jsonb_build_object(
        'id', 'b3000000-0000-4000-8000-000000000003',
        'name', 'Over Capacity Tank',
        'capacity_litres', 100,
        'opening_litres', 50
      )),
      3
    );
    RAISE EXCEPTION 'Over-capacity inline tank unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'Fuel received cannot exceed tank capacity' THEN
      RAISE;
    END IF;
  END;
  IF EXISTS (
    SELECT 1 FROM public.fuel_tanks
    WHERE id = 'b3000000-0000-4000-8000-000000000003'
  ) THEN
    RAISE EXCEPTION 'Failed inline receipt left a partial tank behind';
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    'b2000000-0000-0000-0000-000000000002',
    false
  );
  BEGIN
    PERFORM public.create_fuel_receipt_with_tanks(
      receipt_payload || jsonb_build_object(
        'client_request_id', 'b4000000-0000-4000-8000-000000000005',
        'amount_of_fuel', 120,
        'total_price', 126.80
      ),
      jsonb_build_array(jsonb_build_object(
        'fuel_tank_id', 'b3000000-0000-4000-8000-000000000004',
        'amount_litres', 120
      )),
      jsonb_build_array(jsonb_build_object(
        'id', 'b3000000-0000-4000-8000-000000000004',
        'name', 'Crew Created Tank',
        'capacity_litres', 500,
        'opening_litres', 0
      )),
      3
    );
    RAISE EXCEPTION 'Crew member unexpectedly created a fuel tank';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'Only an HOD or Captain/MOV can add vessel fuel tanks' THEN
      RAISE;
    END IF;
  END;
END;
$$;

ROLLBACK;
