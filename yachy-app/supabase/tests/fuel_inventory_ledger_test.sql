\set ON_ERROR_STOP on

-- Run after the production baseline and all ordered migrations. Reapplying the
-- ledger migration here verifies that its helper capture, schema additions,
-- functions, triggers, policies, and grants are idempotent.
\ir ../migrations/20260918160000_ADD_FUEL_INVENTORY_LEDGER.sql

BEGIN;

INSERT INTO public.vessels (id, name, invite_code, invite_expiry, is_solo)
VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Ledger Test Vessel', 'LEDGER0001', now() + interval '1 year', FALSE),
  ('a1000000-0000-0000-0000-000000000002', 'Other Ledger Vessel', 'LEDGER0002', now() + interval '1 year', FALSE),
  ('a1000000-0000-0000-0000-000000000003', 'Legacy Validator Vessel', 'LEDGER0003', now() + interval '1 year', FALSE),
  ('a1000000-0000-0000-0000-000000000004', 'Account Deletion Vessel', 'LEDGER0004', now() + interval '1 year', FALSE);

-- These two identities exercise the same two-phase path as the account-delete
-- Edge Function: the service-role database RPC followed by Admin API auth-user
-- deletion. Other fixtures do not require auth.users rows.
INSERT INTO auth.users (id) VALUES
  ('a2000000-0000-0000-0000-000000000008'),
  ('a2000000-0000-0000-0000-000000000009');

INSERT INTO public.users (id, email, name, position, department, vessel_id, role)
VALUES
  ('a2000000-0000-0000-0000-000000000001', 'captain@ledger.test', 'Captain Ledger', 'Captain', 'BRIDGE', 'a1000000-0000-0000-0000-000000000001', 'CAPTAIN_MOV'),
  ('a2000000-0000-0000-0000-000000000002', 'hod@ledger.test', 'HOD Ledger', 'Chief Engineer', 'ENGINEERING', 'a1000000-0000-0000-0000-000000000001', 'HOD'),
  ('a2000000-0000-0000-0000-000000000003', 'crew@ledger.test', 'Crew Ledger', 'Deckhand', 'EXTERIOR', 'a1000000-0000-0000-0000-000000000001', 'CREW'),
  ('a2000000-0000-0000-0000-000000000004', 'other@ledger.test', 'Other Ledger', 'Captain', 'BRIDGE', 'a1000000-0000-0000-0000-000000000002', 'CAPTAIN_MOV'),
  ('a2000000-0000-0000-0000-000000000005', 'other.crew@ledger.test', 'Other Crew', 'Deckhand', 'EXTERIOR', 'a1000000-0000-0000-0000-000000000002', 'CREW'),
  ('a2000000-0000-0000-0000-000000000006', 'validator@ledger.test', 'Legacy Validator Captain', 'Captain', 'BRIDGE', 'a1000000-0000-0000-0000-000000000003', 'CAPTAIN_MOV'),
  ('a2000000-0000-0000-0000-000000000007', 'deleted.audit@ledger.test', 'Deleted Audit Actor', 'Deckhand', 'EXTERIOR', 'a1000000-0000-0000-0000-000000000003', 'CREW'),
  ('a2000000-0000-0000-0000-000000000008', 'retained.captain@ledger.test', 'Retained Fuel Captain', 'Captain', 'BRIDGE', 'a1000000-0000-0000-0000-000000000004', 'CAPTAIN_MOV'),
  ('a2000000-0000-0000-0000-000000000009', 'deleting.hod@ledger.test', 'Deleting Fuel HOD', 'Chief Engineer', 'ENGINEERING', 'a1000000-0000-0000-0000-000000000004', 'HOD');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000001', false);

-- The baseline grants functions and tables broadly by default.  The ledger
-- migration must explicitly remove helper execution and every destructive or
-- schema-level table privilege from both API roles.
DO $$
DECLARE
  signature TEXT;
  table_name TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public._fuel_inventory_operation_json(uuid)',
    'public._fuel_inventory_tank_balance_at(uuid,timestamp with time zone)',
    'public._fuel_inventory_existing_request_result(uuid,uuid,text,text)',
    'public._fuel_inventory_existing_request(uuid,uuid,text)',
    'public._lock_fuel_inventory_vessel(uuid)',
    'public._lock_fuel_inventory_request(uuid,uuid)',
    'public._fuel_inventory_legacy_fuel_log_snapshot(uuid)',
    'public._fuel_inventory_legacy_transfer_snapshot(uuid)',
    'public._create_fuel_log_with_tank_entries_legacy(jsonb,jsonb)',
    'public.validate_fuel_transfer_tanks()',
    'public.enforce_fuel_setup_actor()',
    'public.reject_fuel_inventory_legacy_audit_mutation()'
  ] LOOP
    IF has_function_privilege('authenticated', signature, 'EXECUTE')
      OR has_function_privilege('anon', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Private fuel function remains executable: %', signature;
    END IF;
  END LOOP;
  IF NOT has_function_privilege(
      'authenticated', 'public.get_vessel_fuel_setup(uuid)', 'EXECUTE'
  ) OR has_function_privilege(
    'anon', 'public.get_vessel_fuel_setup(uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Public fuel setup reader privileges are incorrect';
  END IF;
  IF NOT has_function_privilege(
      'authenticated', 'public.save_vessel_fuel_setup(uuid,text,jsonb)', 'EXECUTE'
    ) OR has_function_privilege(
      'anon', 'public.save_vessel_fuel_setup(uuid,text,jsonb)', 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Installed-client fuel setup adapter privileges are incorrect';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.get_fuel_inventory_legacy_audits(uuid,text,uuid,integer,timestamp with time zone,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.get_fuel_inventory_legacy_audits(uuid,text,uuid,integer,timestamp with time zone,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Legacy fuel audit reader privileges are incorrect';
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'vessel_fuel_settings', 'fuel_tanks', 'fuel_logs',
    'fuel_log_tank_entries', 'fuel_transfers',
    'fuel_inventory_operations', 'fuel_inventory_postings',
    'fuel_inventory_voids', 'fuel_inventory_request_results',
    'fuel_inventory_legacy_source_audits'
  ] LOOP
    IF has_table_privilege('authenticated', 'public.' || table_name, 'TRUNCATE')
      OR has_table_privilege('authenticated', 'public.' || table_name, 'REFERENCES')
      OR has_table_privilege('authenticated', 'public.' || table_name, 'TRIGGER')
      OR has_table_privilege('anon', 'public.' || table_name, 'TRUNCATE')
      OR has_table_privilege('anon', 'public.' || table_name, 'REFERENCES')
      OR has_table_privilege('anon', 'public.' || table_name, 'TRIGGER') THEN
      RAISE EXCEPTION 'Unsafe API table privilege remains on %', table_name;
    END IF;
  END LOOP;
  IF has_table_privilege(
      'authenticated', 'public.fuel_inventory_request_results', 'SELECT'
    ) OR has_table_privilege(
      'authenticated', 'public.fuel_inventory_legacy_source_audits', 'SELECT'
    ) OR NOT (
      SELECT relrowsecurity FROM pg_class
      WHERE oid = 'public.fuel_inventory_request_results'::regclass
    ) OR NOT (
      SELECT relrowsecurity FROM pg_class
      WHERE oid = 'public.fuel_inventory_legacy_source_audits'::regclass
    ) THEN
    RAISE EXCEPTION 'Private request/audit tables are not locked down';
  END IF;
  IF has_sequence_privilege(
      'authenticated', 'public.fuel_inventory_effective_order_seq', 'USAGE'
    ) OR has_sequence_privilege(
      'authenticated', 'public.fuel_inventory_audit_sequence_seq', 'UPDATE'
    ) OR has_sequence_privilege(
      'authenticated', 'public.fuel_inventory_operations_recorded_sequence_seq', 'USAGE'
    ) OR has_sequence_privilege(
      'anon', 'public.fuel_inventory_operations_recorded_sequence_seq', 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'API role retains fuel audit sequence privileges';
  END IF;

  -- The DB-first bridge restores only installed-client source columns. It must
  -- not reopen any server-owned ledger link, revision, void, actor, or audit
  -- field, and anon remains unable to write either source table.
  IF NOT has_column_privilege(
      'authenticated', 'public.fuel_logs', 'vessel_id', 'INSERT'
    ) OR NOT has_column_privilege(
      'authenticated', 'public.fuel_logs', 'comment', 'UPDATE'
    ) OR NOT has_table_privilege(
      'authenticated', 'public.fuel_logs', 'DELETE'
    ) OR has_column_privilege(
      'authenticated', 'public.fuel_logs', 'inventory_revision', 'UPDATE'
    ) OR has_column_privilege(
      'authenticated', 'public.fuel_logs', 'current_inventory_operation_id', 'INSERT'
    ) OR has_column_privilege(
      'authenticated', 'public.fuel_logs', 'voided_at', 'UPDATE'
    ) OR has_column_privilege(
      'authenticated', 'public.fuel_logs', 'created_by', 'INSERT'
    ) OR has_column_privilege(
      'authenticated', 'public.fuel_logs', 'effective_at', 'INSERT'
    ) OR has_column_privilege(
      'authenticated', 'public.fuel_logs', 'utc_offset_minutes', 'UPDATE'
    ) OR has_column_privilege(
      'anon', 'public.fuel_logs', 'vessel_id', 'INSERT'
    ) THEN
    RAISE EXCEPTION 'Fuel log compatibility grants are too broad or incomplete';
  END IF;
  IF NOT has_column_privilege(
      'authenticated', 'public.fuel_transfers', 'vessel_id', 'INSERT'
    ) OR NOT has_column_privilege(
      'authenticated', 'public.fuel_transfers', 'vessel_id', 'UPDATE'
    ) OR NOT has_column_privilege(
      'authenticated', 'public.fuel_transfers', 'notes', 'UPDATE'
    ) OR NOT has_table_privilege(
      'authenticated', 'public.fuel_transfers', 'DELETE'
    ) OR has_column_privilege(
      'authenticated', 'public.fuel_transfers', 'inventory_revision', 'UPDATE'
    ) OR has_column_privilege(
      'authenticated', 'public.fuel_transfers', 'current_inventory_operation_id', 'INSERT'
    ) OR has_column_privilege(
      'authenticated', 'public.fuel_transfers', 'voided_by', 'UPDATE'
    ) OR has_column_privilege(
      'authenticated', 'public.fuel_transfers', 'created_by', 'INSERT'
    ) OR has_column_privilege(
      'authenticated', 'public.fuel_transfers', 'created_by_name', 'INSERT'
    ) OR has_column_privilege(
      'authenticated', 'public.fuel_transfers', 'created_by_name', 'UPDATE'
    ) OR has_column_privilege(
      'authenticated', 'public.fuel_transfers', 'effective_at', 'INSERT'
    ) OR has_column_privilege(
      'authenticated', 'public.fuel_transfers', 'utc_offset_minutes', 'UPDATE'
    ) OR has_column_privilege(
      'anon', 'public.fuel_transfers', 'vessel_id', 'INSERT'
    ) THEN
    RAISE EXCEPTION 'Fuel transfer compatibility grants are too broad or incomplete';
  END IF;
END;
$$;

-- Before activation, soft-voided legacy source rows remain available for
-- reports/audit but must contribute no volume to allocation, transfer, or
-- capacity validation.  The active rows below leave exactly 5 L / 3 L.
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000006', false);
SELECT public.save_vessel_fuel_setup(
  'a1000000-0000-0000-0000-000000000003', 'LITRES',
  '[{"name":"Legacy Source","capacity_litres":100},{"name":"Legacy Destination","capacity_litres":100}]'::JSONB
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000006', false);

INSERT INTO public.fuel_logs (
  id, vessel_id, location_of_refueling, log_date, log_time,
  amount_of_fuel, price_per_gallon, total_price, volume_unit,
  voided_at, voided_by, voided_by_name
) VALUES (
  'a7200000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000003',
  'Voided legacy receipt', current_date, localtime::TIME,
  95, 1, 95, 'LITRES', clock_timestamp(),
  'a2000000-0000-0000-0000-000000000006', 'Legacy Validator Captain'
);
INSERT INTO public.fuel_log_tank_entries (
  vessel_id, fuel_log_id, fuel_tank_id, amount_litres
) VALUES (
  'a1000000-0000-0000-0000-000000000003',
  'a7200000-0000-0000-0000-000000000001',
  (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000003'
      AND name = 'Legacy Source'),
  95
);

INSERT INTO public.fuel_logs (
  id, vessel_id, location_of_refueling, log_date, log_time,
  amount_of_fuel, price_per_gallon, total_price, volume_unit
) VALUES (
  'a7200000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000003',
  'Active legacy receipt', current_date, localtime::TIME,
  8, 1, 8, 'LITRES'
);
INSERT INTO public.fuel_log_tank_entries (
  vessel_id, fuel_log_id, fuel_tank_id, amount_litres
) VALUES (
  'a1000000-0000-0000-0000-000000000003',
  'a7200000-0000-0000-0000-000000000002',
  (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000003'
      AND name = 'Legacy Source'),
  8
);

INSERT INTO public.fuel_transfers (
  id, vessel_id, source_tank_id, destination_tank_id, amount_litres,
  transfer_date, transfer_time, location, notes,
  voided_at, voided_by, voided_by_name
) VALUES (
  'a7300000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000003',
  (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000003'
      AND name = 'Legacy Source'),
  (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000003'
      AND name = 'Legacy Destination'),
  99, current_date, localtime::TIME, 'Void fixture', 'Retained only',
  clock_timestamp(), 'a2000000-0000-0000-0000-000000000006',
  'Legacy Validator Captain'
);

INSERT INTO public.fuel_transfers (
  id, vessel_id, source_tank_id, destination_tank_id, amount_litres,
  transfer_date, transfer_time, location, notes
) VALUES (
  'a7300000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000003',
  (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000003'
      AND name = 'Legacy Source'),
  (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000003'
      AND name = 'Legacy Destination'),
  3, current_date, localtime::TIME, 'Active fixture', 'Counts toward balance'
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000006', false);
SELECT public.save_vessel_fuel_setup(
  'a1000000-0000-0000-0000-000000000003', 'LITRES',
  jsonb_build_array(
    jsonb_build_object(
      'id', (SELECT id FROM public.fuel_tanks
        WHERE vessel_id = 'a1000000-0000-0000-0000-000000000003'
          AND name = 'Legacy Source'),
      'name', 'Legacy Source', 'capacity_litres', 8
    ),
    jsonb_build_object(
      'id', (SELECT id FROM public.fuel_tanks
        WHERE vessel_id = 'a1000000-0000-0000-0000-000000000003'
          AND name = 'Legacy Destination'),
      'name', 'Legacy Destination', 'capacity_litres', 3
    )
  ),
  1, 'a5200000-0000-0000-0000-000000000002'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.vessel_fuel_settings
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000003'
      AND inventory_activated_at IS NOT NULL
  ) OR (SELECT setup_revision FROM public.vessel_fuel_settings
        WHERE vessel_id = 'a1000000-0000-0000-0000-000000000003') <> 2
    OR (SELECT capacity_litres FROM public.fuel_tanks
        WHERE vessel_id = 'a1000000-0000-0000-0000-000000000003'
          AND name = 'Legacy Source') <> 8
    OR (SELECT capacity_litres FROM public.fuel_tanks
        WHERE vessel_id = 'a1000000-0000-0000-0000-000000000003'
          AND name = 'Legacy Destination') <> 3 THEN
    RAISE EXCEPTION 'Pre-activation validators counted soft-voided source rows';
  END IF;
END;
$$;

-- The immutable audit keeps the actor-name evidence when its actor profile is
-- deleted.  Only the FK's created_by -> NULL cleanup may pass the trigger.
RESET ROLE;
INSERT INTO public.fuel_inventory_legacy_source_audits (
  id, vessel_id, source_type, source_id, action,
  before_snapshot, after_snapshot, reason, client_request_id,
  created_by, created_by_name
) VALUES (
  'a7400000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000003',
  'FUEL_LOG', 'a7200000-0000-0000-0000-000000000001', 'AMENDMENT',
  '{"inventory_revision":0,"marker":"before"}'::JSONB,
  '{"inventory_revision":1,"marker":"after"}'::JSONB,
  'Deletion retention fixture', 'a5200000-0000-0000-0000-000000000003',
  'a2000000-0000-0000-0000-000000000007', 'Deleted Audit Actor'
);
DELETE FROM public.users
WHERE id = 'a2000000-0000-0000-0000-000000000007';

DO $$
DECLARE
  retained public.fuel_inventory_legacy_source_audits%ROWTYPE;
BEGIN
  SELECT * INTO STRICT retained
  FROM public.fuel_inventory_legacy_source_audits
  WHERE id = 'a7400000-0000-0000-0000-000000000001';
  IF retained.created_by IS NOT NULL
    OR retained.created_by_name <> 'Deleted Audit Actor'
    OR retained.reason <> 'Deletion retention fixture'
    OR retained.before_snapshot <> '{"inventory_revision":0,"marker":"before"}'::JSONB
    OR retained.after_snapshot <> '{"inventory_revision":1,"marker":"after"}'::JSONB THEN
    RAISE EXCEPTION 'Legacy audit actor deletion changed immutable evidence';
  END IF;
END;
$$;

SET ROLE authenticated;

-- A pre-activation receipt is report-only but still offline-idempotent.  It
-- must return the original row on response-loss retry and reject UUID reuse.
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000004', false);
SELECT public.save_vessel_fuel_setup(
  'a1000000-0000-0000-0000-000000000002', 'LITRES',
  '[{"name":"Legacy Tank","capacity_litres":300},{"name":"Legacy Day Tank","capacity_litres":100}]'::JSONB,
  0, 'a5000000-0000-0000-0000-000000000001'
);
SELECT public.save_vessel_fuel_setup(
  'a1000000-0000-0000-0000-000000000002', 'LITRES',
  '[{"name":"Legacy Tank","capacity_litres":300},{"name":"Legacy Day Tank","capacity_litres":100}]'::JSONB,
  0, 'a5000000-0000-0000-0000-000000000001'
);

DO $$
DECLARE
  first_result JSONB;
  retry_result JSONB;
  rejected BOOLEAN := FALSE;
  event_at TIMESTAMPTZ := clock_timestamp();
  ship_offset_minutes CONSTANT SMALLINT := 600;
  legacy_tank_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND name = 'Legacy Tank');
BEGIN
  IF (public.get_vessel_fuel_setup(
      'a1000000-0000-0000-0000-000000000002'
    ) #>> '{settings,setup_revision}')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'Exact setup retry changed setup revision';
  END IF;

  first_result := public.create_fuel_log_with_tank_entries(
    jsonb_build_object(
      'vessel_id', 'a1000000-0000-0000-0000-000000000002',
      'location_of_refueling', 'Legacy quay',
      'log_date', ((event_at AT TIME ZONE 'UTC')
        + make_interval(mins => ship_offset_minutes))::DATE,
      'log_time', ((event_at AT TIME ZONE 'UTC')
        + make_interval(mins => ship_offset_minutes))::TIME,
      'amount_of_fuel', 25, 'price_per_gallon', 1, 'total_price', 25,
      'volume_unit', 'LITRES', 'currency_code', 'USD',
      'effective_at', event_at,
      'utc_offset_minutes', ship_offset_minutes,
      'client_request_id', 'a5000000-0000-0000-0000-000000000002'
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', legacy_tank_id, 'amount_litres', 25
    ))
  );
  retry_result := public.create_fuel_log_with_tank_entries(
    jsonb_build_object(
      'vessel_id', 'a1000000-0000-0000-0000-000000000002',
      'location_of_refueling', 'Legacy quay',
      'log_date', ((event_at AT TIME ZONE 'UTC')
        + make_interval(mins => ship_offset_minutes))::DATE,
      'log_time', ((event_at AT TIME ZONE 'UTC')
        + make_interval(mins => ship_offset_minutes))::TIME,
      'amount_of_fuel', 25, 'price_per_gallon', 1, 'total_price', 25,
      'volume_unit', 'LITRES', 'currency_code', 'USD',
      'effective_at', event_at,
      'utc_offset_minutes', ship_offset_minutes,
      'client_request_id', 'a5000000-0000-0000-0000-000000000002'
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', legacy_tank_id, 'amount_litres', 25
    ))
  );
  IF first_result ->> 'id' IS DISTINCT FROM retry_result ->> 'id'
    OR (first_result ->> 'effective_at')::TIMESTAMPTZ IS DISTINCT FROM event_at
    OR (first_result ->> 'utc_offset_minutes')::SMALLINT <> ship_offset_minutes
    OR (SELECT effective_at FROM public.fuel_logs
        WHERE id = (first_result ->> 'id')::UUID) IS DISTINCT FROM event_at
    OR (SELECT utc_offset_minutes FROM public.fuel_logs
        WHERE id = (first_result ->> 'id')::UUID) <> ship_offset_minutes
    OR (SELECT count(*) FROM public.fuel_logs
        WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002') <> 1 THEN
    RAISE EXCEPTION 'Legacy receipt retry created a duplicate';
  END IF;

  BEGIN
    PERFORM public.create_fuel_log_with_tank_entries(
      jsonb_build_object(
        'vessel_id', 'a1000000-0000-0000-0000-000000000002',
        'log_date', ((event_at AT TIME ZONE 'UTC')
          + make_interval(mins => ship_offset_minutes))::DATE,
        'log_time', ((event_at AT TIME ZONE 'UTC')
          + make_interval(mins => ship_offset_minutes))::TIME,
        'amount_of_fuel', 26, 'price_per_gallon', 1, 'total_price', 26,
        'volume_unit', 'LITRES', 'currency_code', 'USD',
        'effective_at', event_at,
        'utc_offset_minutes', ship_offset_minutes,
        'client_request_id', 'a5000000-0000-0000-0000-000000000002'
      ),
      jsonb_build_array(jsonb_build_object(
        'fuel_tank_id', legacy_tank_id, 'amount_litres', 26
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%different payload%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Legacy request UUID was reused'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.create_fuel_log_with_tank_entries(
      jsonb_build_object(
        'vessel_id', 'a1000000-0000-0000-0000-000000000002',
        'log_date', ((event_at AT TIME ZONE 'UTC')
          + make_interval(mins => ship_offset_minutes))::DATE,
        'log_time', ((event_at AT TIME ZONE 'UTC')
          + make_interval(mins => ship_offset_minutes))::TIME,
        'amount_of_fuel', 1, 'price_per_gallon', 1, 'total_price', 1,
        'volume_unit', 'LITRES', 'currency_code', 'USD',
        'effective_at', event_at,
        'client_request_id', 'a5e00000-0000-0000-0000-000000000001'
      ),
      jsonb_build_array(jsonb_build_object(
        'fuel_tank_id', legacy_tank_id, 'amount_litres', 1
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%require an effective time and UTC offset%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Partial receipt UTC evidence was accepted'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.create_fuel_log_with_tank_entries(
      jsonb_build_object(
        'vessel_id', 'a1000000-0000-0000-0000-000000000002',
        'log_date', '2000-01-01', 'log_time', '12:00',
        'amount_of_fuel', 1, 'price_per_gallon', 1, 'total_price', 1,
        'volume_unit', 'LITRES', 'currency_code', 'USD',
        'effective_at', '2000-01-01T12:00:00Z', 'utc_offset_minutes', 0,
        'client_request_id', 'a5e00000-0000-0000-0000-000000000002'
      ),
      jsonb_build_array(jsonb_build_object(
        'fuel_tank_id', legacy_tank_id, 'amount_litres', 1
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%active on the vessel at the ship time%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Receipt predating its tank was accepted'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.save_vessel_fuel_setup(
      'a1000000-0000-0000-0000-000000000002', 'LITRES',
      jsonb_build_array(jsonb_build_object(
        'id', legacy_tank_id, 'name', 'Stale edit', 'capacity_litres', 300
      )), 0, 'a5000000-0000-0000-0000-000000000003'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%changed since it was loaded%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Stale fuel setup save was accepted'; END IF;
END;
$$;

-- A pre-activation transfer is report-only but still uses the same durable
-- request UUID semantics as an activated ledger transfer. It must preserve
-- the exact committed response, reject payload drift, and create no ledger
-- operation or posting while tank quantities are unknown.
DO $$
DECLARE
  target_vessel_id CONSTANT UUID := 'a1000000-0000-0000-0000-000000000002';
  request_id CONSTANT UUID := 'a5f00000-0000-0000-0000-000000000001';
  source_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND name = 'Legacy Tank');
  destination_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND name = 'Legacy Day Tank');
  event_at TIMESTAMPTZ := clock_timestamp();
  transfer_payload JSONB;
  first_result JSONB;
  retry_result JSONB;
  cumulative_receipt JSONB;
  rejected BOOLEAN := FALSE;
BEGIN
  transfer_payload := jsonb_build_object(
    'vessel_id', target_vessel_id,
    -- The day tank has no prior receipt. A truthful report-only transfer must
    -- not infer a zero opening balance and reject this source movement.
    'source_tank_id', destination_id,
    'destination_tank_id', source_id,
    'amount_litres', 4.5,
    'effective_at', event_at,
    'utc_offset_minutes', 0,
    'transfer_date', (event_at AT TIME ZONE 'UTC')::DATE,
    'transfer_time', (event_at AT TIME ZONE 'UTC')::TIME,
    'location', 'Legacy engine room',
    'notes', 'Report-only transfer before opening levels'
  );
  first_result := public.record_fuel_transfer(transfer_payload, request_id);
  retry_result := public.record_fuel_transfer(transfer_payload, request_id);

  IF first_result IS DISTINCT FROM retry_result
    OR first_result ->> 'id' IS NULL
    OR first_result ->> 'current_inventory_operation_id' IS NOT NULL
    OR (first_result ->> 'inventory_revision')::INTEGER <> 0
    OR (first_result ->> 'effective_at')::TIMESTAMPTZ IS DISTINCT FROM event_at
    OR (first_result ->> 'utc_offset_minutes')::SMALLINT <> 0
    OR (SELECT effective_at FROM public.fuel_transfers
        WHERE id = (first_result ->> 'id')::UUID) IS DISTINCT FROM event_at
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        public.get_fuel_transfers_with_snapshots(target_vessel_id) -> 'transfers'
      ) AS transfer
      WHERE transfer ->> 'id' = first_result ->> 'id'
        AND (transfer ->> 'effective_at')::TIMESTAMPTZ IS NOT DISTINCT FROM event_at
        AND (transfer ->> 'utc_offset_minutes')::SMALLINT = 0
    )
    OR (SELECT count(*) FROM public.fuel_transfers
        WHERE vessel_id = target_vessel_id
          AND notes = 'Report-only transfer before opening levels') <> 1
    OR EXISTS (
      SELECT 1 FROM public.fuel_inventory_operations
      WHERE source_fuel_transfer_id = (first_result ->> 'id')::UUID
    )
    OR EXISTS (
      SELECT 1 FROM public.fuel_inventory_postings AS posting
      JOIN public.fuel_inventory_operations AS operation
        ON operation.id = posting.operation_id
      WHERE operation.source_fuel_transfer_id = (first_result ->> 'id')::UUID
    ) THEN
    RAISE EXCEPTION 'Pre-activation transfer was not persisted as one replay-safe report row';
  END IF;

  BEGIN
    PERFORM public.record_fuel_transfer(
      transfer_payload || jsonb_build_object('amount_litres', 4.75),
      request_id
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%different payload%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Pre-activation transfer request UUID accepted a changed payload';
  END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.record_fuel_transfer(
      transfer_payload || jsonb_build_object(
        'effective_at', '2000-01-01T12:00:00Z',
        'transfer_date', '2000-01-01', 'transfer_time', '12:00'
      ),
      'a5f00000-0000-0000-0000-000000000003'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%active on the vessel at the ship time%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Transfer predating its tanks was accepted'; END IF;

  -- Legacy Tank already has a 25 L report receipt. This separate 290 L event
  -- is individually within its 300 L physical capacity, but the historical
  -- sum is intentionally above capacity. Without a truthful opening level and
  -- consumption history, that sum must never be treated as a current balance.
  cumulative_receipt := public.create_fuel_log_with_tank_entries(
    jsonb_build_object(
      'vessel_id', target_vessel_id,
      'location_of_refueling', 'Second report-only delivery',
      'log_date', (event_at AT TIME ZONE 'UTC')::DATE,
      'log_time', (event_at AT TIME ZONE 'UTC')::TIME,
      'amount_of_fuel', 290, 'price_per_gallon', 1, 'total_price', 290,
      'volume_unit', 'LITRES', 'currency_code', 'USD',
      'effective_at', event_at, 'utc_offset_minutes', 0,
      'client_request_id', 'a5f00000-0000-0000-0000-000000000002'
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', source_id, 'amount_litres', 290
    ))
  );
  IF cumulative_receipt ->> 'current_inventory_operation_id' IS NOT NULL
    OR (cumulative_receipt ->> 'effective_at')::TIMESTAMPTZ
      IS DISTINCT FROM event_at
    OR (SELECT count(*) FROM public.fuel_logs
        WHERE vessel_id = target_vessel_id
          AND location_of_refueling = 'Second report-only delivery') <> 1 THEN
    RAISE EXCEPTION 'Pre-activation receipts were still treated as a cumulative balance';
  END IF;
END;
$$;

RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.fuel_inventory_request_results AS request_result
    JOIN public.fuel_transfers AS transfer
      ON transfer.id = (request_result.result_payload ->> 'id')::UUID
    WHERE request_result.vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND request_result.client_request_id = 'a5f00000-0000-0000-0000-000000000001'
      AND request_result.request_kind = 'LEGACY_TRANSFER_CREATE'
      AND transfer.notes = 'Report-only transfer before opening levels'
      AND request_result.result_payload = to_jsonb(transfer)
  ) THEN
    RAISE EXCEPTION 'Pre-activation transfer did not retain its durable response';
  END IF;
END;
$$;
SET ROLE authenticated;

-- The installed client can still use its direct source-table writes and old
-- receipt-update shape before activation. These paths retain RLS and actor
-- enforcement, and they deliberately create no ledger/audit records.
DO $$
DECLARE
  target_vessel_id CONSTANT UUID := 'a1000000-0000-0000-0000-000000000002';
  legacy_log_id UUID := (SELECT id FROM public.fuel_logs
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND location_of_refueling = 'Legacy quay');
  source_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND name = 'Legacy Tank');
  destination_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND name = 'Legacy Day Tank');
  direct_log_id UUID;
  direct_transfer_id UUID;
  precise_transfer_id UUID := (SELECT id FROM public.fuel_transfers
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND notes = 'Report-only transfer before opening levels');
  prior_effective_at TIMESTAMPTZ;
  shifted_effective_at TIMESTAMPTZ;
  retained_offset SMALLINT;
BEGIN
  PERFORM public.update_fuel_log_with_tank_entries(
    legacy_log_id,
    target_vessel_id,
    jsonb_build_object('comment', 'Installed client pre-activation edit'),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', source_id, 'amount_litres', 25
    ))
  );
  IF (SELECT comment FROM public.fuel_logs WHERE id = legacy_log_id)
      <> 'Installed client pre-activation edit'
    OR (SELECT inventory_revision FROM public.fuel_logs WHERE id = legacy_log_id) <> 0 THEN
    RAISE EXCEPTION 'Installed-client receipt update did not remain pre-ledger';
  END IF;

  SELECT effective_at, utc_offset_minutes
  INTO prior_effective_at, retained_offset
  FROM public.fuel_logs WHERE id = legacy_log_id;
  shifted_effective_at := prior_effective_at + INTERVAL '1 second';
  PERFORM public.update_fuel_log_with_tank_entries(
    legacy_log_id,
    target_vessel_id,
    jsonb_build_object(
      'log_date', ((shifted_effective_at AT TIME ZONE 'UTC')
        + make_interval(mins => retained_offset))::DATE,
      'log_time', ((shifted_effective_at AT TIME ZONE 'UTC')
        + make_interval(mins => retained_offset))::TIME
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', source_id, 'amount_litres', 25
    ))
  );
  IF (SELECT effective_at FROM public.fuel_logs WHERE id = legacy_log_id)
      IS DISTINCT FROM shifted_effective_at
    OR (SELECT utc_offset_minutes FROM public.fuel_logs WHERE id = legacy_log_id)
      <> retained_offset THEN
    RAISE EXCEPTION 'Installed-client receipt edit left contradictory UTC evidence';
  END IF;

  SELECT effective_at, utc_offset_minutes
  INTO prior_effective_at, retained_offset
  FROM public.fuel_transfers WHERE id = precise_transfer_id;
  shifted_effective_at := prior_effective_at + INTERVAL '1 second';
  UPDATE public.fuel_transfers
  SET transfer_date = ((shifted_effective_at AT TIME ZONE 'UTC')
        + make_interval(mins => retained_offset))::DATE,
      transfer_time = ((shifted_effective_at AT TIME ZONE 'UTC')
        + make_interval(mins => retained_offset))::TIME
  WHERE id = precise_transfer_id;
  IF (SELECT effective_at FROM public.fuel_transfers WHERE id = precise_transfer_id)
      IS DISTINCT FROM shifted_effective_at
    OR (SELECT utc_offset_minutes FROM public.fuel_transfers
        WHERE id = precise_transfer_id) <> retained_offset THEN
    RAISE EXCEPTION 'Installed-client transfer edit left contradictory UTC evidence';
  END IF;

  INSERT INTO public.fuel_logs (
    vessel_id, location_of_refueling, log_date, log_time,
    amount_of_fuel, price_per_gallon, total_price, created_by_name,
    volume_unit, currency_code, comment
  ) VALUES (
    target_vessel_id, 'Direct compatibility receipt', current_date, localtime::TIME,
    2, 1.5, 3, 'Spoofed actor', 'LITRES', 'USD', 'Created by installed client'
  ) RETURNING id INTO direct_log_id;
  IF (SELECT created_by FROM public.fuel_logs WHERE id = direct_log_id)
      <> 'a2000000-0000-0000-0000-000000000004'::UUID
    OR (SELECT created_by_name FROM public.fuel_logs WHERE id = direct_log_id)
      <> 'Other Ledger' THEN
    RAISE EXCEPTION 'Direct fuel log compatibility write bypassed actor enforcement';
  END IF;
  UPDATE public.fuel_logs
  SET comment = 'Updated by installed client'
  WHERE id = direct_log_id;
  IF (SELECT comment FROM public.fuel_logs WHERE id = direct_log_id)
      <> 'Updated by installed client' THEN
    RAISE EXCEPTION 'Direct pre-activation fuel log update was not persisted';
  END IF;
  DELETE FROM public.fuel_logs WHERE id = direct_log_id;
  IF EXISTS (SELECT 1 FROM public.fuel_logs WHERE id = direct_log_id) THEN
    RAISE EXCEPTION 'Direct pre-activation fuel log delete was not persisted';
  END IF;

  INSERT INTO public.fuel_transfers (
    vessel_id, source_tank_id, destination_tank_id, amount_litres,
    transfer_date, transfer_time, location, notes
  ) VALUES (
    target_vessel_id, source_id, destination_id, 1.25,
    current_date, localtime::TIME, 'Compatibility test', 'Installed client create'
  ) RETURNING id INTO direct_transfer_id;
  IF (SELECT created_by FROM public.fuel_transfers WHERE id = direct_transfer_id)
      <> 'a2000000-0000-0000-0000-000000000004'::UUID
    OR (SELECT created_by_name FROM public.fuel_transfers WHERE id = direct_transfer_id)
      <> 'Other Ledger' THEN
    RAISE EXCEPTION 'Direct fuel transfer compatibility write bypassed actor enforcement';
  END IF;
  UPDATE public.fuel_transfers
  SET vessel_id = target_vessel_id, notes = 'Installed client update'
  WHERE id = direct_transfer_id;
  IF (SELECT notes FROM public.fuel_transfers WHERE id = direct_transfer_id)
      <> 'Installed client update' THEN
    RAISE EXCEPTION 'Direct pre-activation fuel transfer update was not persisted';
  END IF;
  DELETE FROM public.fuel_transfers WHERE id = direct_transfer_id;
  IF EXISTS (SELECT 1 FROM public.fuel_transfers WHERE id = direct_transfer_id) THEN
    RAISE EXCEPTION 'Direct pre-activation fuel transfer delete was not persisted';
  END IF;
END;
$$;

-- An installed build must revalidate tank lifecycle at write time. It may
-- continue editing a report that already retained a now-archived tank, but a
-- stale setup screen cannot newly select that archived tank for a receipt or
-- transfer.
SELECT public.save_vessel_fuel_setup(
  'a1000000-0000-0000-0000-000000000002', 'LITRES',
  jsonb_build_array(
    jsonb_build_object(
      'id', (SELECT id FROM public.fuel_tanks
        WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
          AND name = 'Legacy Tank'),
      'name', 'Legacy Tank', 'capacity_litres', 300
    ),
    jsonb_build_object(
      'id', (SELECT id FROM public.fuel_tanks
        WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
          AND name = 'Legacy Day Tank'),
      'name', 'Legacy Day Tank', 'capacity_litres', 100
    ),
    jsonb_build_object(
      'name', 'Stale Compatibility Tank', 'capacity_litres', 50
    )
  ),
  1, 'a5000000-0000-0000-0000-000000000020'
);

CREATE TEMP TABLE installed_client_lifecycle_fixture (
  receipt_id UUID NOT NULL,
  retained_transfer_id UUID NOT NULL,
  active_transfer_id UUID NOT NULL,
  stale_tank_id UUID NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT ON installed_client_lifecycle_fixture TO authenticated;

DO $$
DECLARE
  target_vessel_id CONSTANT UUID := 'a1000000-0000-0000-0000-000000000002';
  source_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = target_vessel_id AND name = 'Legacy Tank');
  destination_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = target_vessel_id AND name = 'Legacy Day Tank');
  stale_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = target_vessel_id AND name = 'Stale Compatibility Tank');
  receipt_id UUID;
  retained_transfer_id UUID;
  active_transfer_id UUID;
BEGIN
  INSERT INTO public.fuel_logs (
    vessel_id, location_of_refueling, log_date, log_time,
    amount_of_fuel, price_per_gallon, total_price,
    volume_unit, currency_code, comment
  ) VALUES (
    target_vessel_id, 'Installed lifecycle quay', current_date,
    localtime::TIME, 3, 1, 3, 'LITRES', 'USD', 'Retained lifecycle receipt'
  ) RETURNING id INTO receipt_id;
  PERFORM public.update_fuel_log_with_tank_entries(
    receipt_id, target_vessel_id,
    jsonb_build_object('comment', 'Retained lifecycle receipt'),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', stale_id, 'amount_litres', 3
    ))
  );

  INSERT INTO public.fuel_transfers (
    vessel_id, source_tank_id, destination_tank_id, amount_litres,
    transfer_date, transfer_time, location, notes
  ) VALUES (
    target_vessel_id, source_id, stale_id, 1,
    current_date, localtime::TIME, 'Lifecycle test', 'Retained transfer'
  ) RETURNING id INTO retained_transfer_id;

  INSERT INTO public.fuel_transfers (
    vessel_id, source_tank_id, destination_tank_id, amount_litres,
    transfer_date, transfer_time, location, notes
  ) VALUES (
    target_vessel_id, source_id, destination_id, 1,
    current_date, localtime::TIME, 'Lifecycle test', 'Active transfer'
  ) RETURNING id INTO active_transfer_id;

  INSERT INTO installed_client_lifecycle_fixture VALUES (
    receipt_id, retained_transfer_id, active_transfer_id, stale_id
  );
END;
$$;

SELECT public.save_vessel_fuel_setup(
  'a1000000-0000-0000-0000-000000000002', 'LITRES',
  jsonb_build_array(
    jsonb_build_object(
      'id', (SELECT id FROM public.fuel_tanks
        WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
          AND name = 'Legacy Tank'),
      'name', 'Legacy Tank', 'capacity_litres', 300
    ),
    jsonb_build_object(
      'id', (SELECT id FROM public.fuel_tanks
        WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
          AND name = 'Legacy Day Tank'),
      'name', 'Legacy Day Tank', 'capacity_litres', 100
    )
  ),
  2, 'a5000000-0000-0000-0000-000000000021'
);

DO $$
DECLARE
  target_vessel_id CONSTANT UUID := 'a1000000-0000-0000-0000-000000000002';
  fixture installed_client_lifecycle_fixture%ROWTYPE;
  legacy_log_id UUID := (SELECT id FROM public.fuel_logs
    WHERE vessel_id = target_vessel_id AND location_of_refueling = 'Legacy quay');
  source_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = target_vessel_id AND name = 'Legacy Tank');
  rejected BOOLEAN := FALSE;
BEGIN
  SELECT * INTO STRICT fixture FROM installed_client_lifecycle_fixture;

  PERFORM public.update_fuel_log_with_tank_entries(
    fixture.receipt_id, target_vessel_id,
    jsonb_build_object('comment', 'Retained archived allocation edit'),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', fixture.stale_tank_id, 'amount_litres', 3
    ))
  );
  UPDATE public.fuel_transfers
  SET notes = 'Retained archived transfer edit'
  WHERE id = fixture.retained_transfer_id;

  BEGIN
    PERFORM public.update_fuel_log_with_tank_entries(
      legacy_log_id, target_vessel_id,
      jsonb_build_object('comment', 'Stale archived allocation attempt'),
      jsonb_build_array(jsonb_build_object(
        'fuel_tank_id', fixture.stale_tank_id, 'amount_litres', 25
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%tanks available at the ship time%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Installed-client receipt selected a newly archived tank';
  END IF;

  rejected := FALSE;
  BEGIN
    INSERT INTO public.fuel_transfers (
      vessel_id, source_tank_id, destination_tank_id, amount_litres,
      transfer_date, transfer_time, location, notes
    ) VALUES (
      target_vessel_id, source_id, fixture.stale_tank_id, 1,
      current_date, localtime::TIME, 'Lifecycle test', 'Stale create attempt'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%only use active tanks%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Installed client created a transfer with an archived tank';
  END IF;

  rejected := FALSE;
  BEGIN
    UPDATE public.fuel_transfers
    SET destination_tank_id = fixture.stale_tank_id
    WHERE id = fixture.active_transfer_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%only use active tanks%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Installed client moved a transfer to an archived tank';
  END IF;

  DELETE FROM public.fuel_logs WHERE id = fixture.receipt_id;
  DELETE FROM public.fuel_transfers
  WHERE id IN (fixture.retained_transfer_id, fixture.active_transfer_id);
END;
$$;

-- Report-only history does not establish a balance, so cumulative deliveries
-- may exceed a new catalogue capacity. Each individual retained event must
-- still fit physically, for both receipts and transfers.
DO $$
DECLARE
  target_vessel_id CONSTANT UUID := 'a1000000-0000-0000-0000-000000000002';
  main_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = target_vessel_id AND name = 'Legacy Tank');
  day_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = target_vessel_id AND name = 'Legacy Day Tank');
  rejected BOOLEAN := FALSE;
BEGIN
  PERFORM public.save_vessel_fuel_setup(
    target_vessel_id, 'LITRES',
    jsonb_build_array(
      jsonb_build_object(
        'id', main_id, 'name', 'Legacy Tank', 'capacity_litres', 295
      ),
      jsonb_build_object(
        'id', day_id, 'name', 'Legacy Day Tank', 'capacity_litres', 100
      )
    ),
    3, 'a5000000-0000-0000-0000-000000000022'
  );

  BEGIN
    PERFORM public.save_vessel_fuel_setup(
      target_vessel_id, 'LITRES',
      jsonb_build_array(
        jsonb_build_object(
          'id', main_id, 'name', 'Legacy Tank', 'capacity_litres', 289
        ),
        jsonb_build_object(
          'id', day_id, 'name', 'Legacy Day Tank', 'capacity_litres', 100
        )
      ),
      4, 'a5000000-0000-0000-0000-000000000023'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%lower than a retained report event%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Tank capacity fell below one retained receipt allocation';
  END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.save_vessel_fuel_setup(
      target_vessel_id, 'LITRES',
      jsonb_build_array(
        jsonb_build_object(
          'id', main_id, 'name', 'Legacy Tank', 'capacity_litres', 295
        ),
        jsonb_build_object(
          'id', day_id, 'name', 'Legacy Day Tank', 'capacity_litres', 4
        )
      ),
      4, 'a5000000-0000-0000-0000-000000000024'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%lower than a retained report event%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Tank capacity fell below one retained transfer event';
  END IF;

  IF (SELECT capacity_litres FROM public.fuel_tanks WHERE id = main_id) <> 295
    OR (SELECT capacity_litres FROM public.fuel_tanks WHERE id = day_id) <> 100
    OR (SELECT setup_revision FROM public.vessel_fuel_settings
        WHERE vessel_id = target_vessel_id) <> 4 THEN
    RAISE EXCEPTION 'Rejected report-event capacity change partially persisted';
  END IF;

  PERFORM public.save_vessel_fuel_setup(
    target_vessel_id, 'LITRES',
    jsonb_build_array(
      jsonb_build_object(
        'id', main_id, 'name', 'Legacy Tank', 'capacity_litres', 300
      ),
      jsonb_build_object(
        'id', day_id, 'name', 'Legacy Day Tank', 'capacity_litres', 100
      )
    ),
    4, 'a5000000-0000-0000-0000-000000000025'
  );
END;
$$;

-- A precise report may be recorded a few minutes ahead for clock tolerance,
-- but setup cannot archive its tank before that known event. The surrounding
-- exception block deliberately rolls this temporary fixture back in full.
DO $$
DECLARE
  target_vessel_id CONSTANT UUID := 'a1000000-0000-0000-0000-000000000002';
  main_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = target_vessel_id AND name = 'Legacy Tank');
  day_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = target_vessel_id AND name = 'Legacy Day Tank');
  event_at TIMESTAMPTZ := clock_timestamp() + INTERVAL '2 minutes';
  rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.record_fuel_transfer(
      jsonb_build_object(
        'vessel_id', target_vessel_id,
        'source_tank_id', day_id,
        'destination_tank_id', main_id,
        'amount_litres', 1,
        'effective_at', event_at,
        'utc_offset_minutes', 0,
        'transfer_date', (event_at AT TIME ZONE 'UTC')::DATE,
        'transfer_time', (event_at AT TIME ZONE 'UTC')::TIME,
        'location', 'Future archive guard',
        'notes', 'Temporary future report'
      ),
      'a5f00000-0000-0000-0000-000000000020'
    );

    BEGIN
      PERFORM public.save_vessel_fuel_setup(
        target_vessel_id, 'LITRES',
        jsonb_build_array(jsonb_build_object(
          'id', main_id, 'name', 'Legacy Tank', 'capacity_litres', 300
        )),
        5, 'a5000000-0000-0000-0000-000000000026'
      );
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%cannot be archived before a retained report event%' THEN
        RAISE;
      END IF;
      rejected := TRUE;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION 'Tank was archived before a precise future report event';
    END IF;

    RAISE EXCEPTION 'ROLLBACK_FUTURE_REPORT_FIXTURE';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_FUTURE_REPORT_FIXTURE' THEN RAISE; END IF;
  END;
END;
$$;

-- Exercise the application's real two-phase account deletion path against an
-- installed-client receipt/transfer that is later retained and audited after
-- activation. A shared vessel keeps every business/audit row while actor FKs
-- clear; immutable name snapshots and every non-actor field must survive.
CREATE TEMP TABLE account_delete_fuel_fixture (
  fuel_log_id UUID NOT NULL,
  fuel_transfer_id UUID NOT NULL,
  settings_snapshot JSONB,
  tanks_snapshot JSONB,
  fuel_log_snapshot JSONB,
  fuel_transfer_snapshot JSONB,
  operations_snapshot JSONB,
  postings_snapshot JSONB,
  voids_snapshot JSONB,
  audits_snapshot JSONB,
  request_results_snapshot JSONB
) ON COMMIT DROP;
GRANT SELECT, INSERT ON account_delete_fuel_fixture TO authenticated;

SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000009', false);
SELECT public.save_vessel_fuel_setup(
  'a1000000-0000-0000-0000-000000000004', 'LITRES',
  '[{"name":"Delete Main","capacity_litres":500},{"name":"Delete Day","capacity_litres":100}]'::JSONB
);

DO $$
DECLARE
  target_vessel_id CONSTANT UUID := 'a1000000-0000-0000-0000-000000000004';
  main_id UUID := (SELECT tank.id FROM public.fuel_tanks AS tank
    WHERE tank.vessel_id = 'a1000000-0000-0000-0000-000000000004'
      AND tank.name = 'Delete Main');
  day_id UUID := (SELECT tank.id FROM public.fuel_tanks AS tank
    WHERE tank.vessel_id = 'a1000000-0000-0000-0000-000000000004'
      AND tank.name = 'Delete Day');
  log_id UUID;
  transfer_id UUID;
  operation_id UUID;
  operation_result JSONB;
  effective_at TIMESTAMPTZ;
BEGIN
  INSERT INTO public.fuel_logs (
    vessel_id, location_of_refueling, log_date, log_time,
    amount_of_fuel, price_per_gallon, total_price, created_by_name,
    volume_unit, currency_code, comment
  ) VALUES (
    target_vessel_id, 'Account deletion quay', current_date, localtime::TIME,
    10, 1, 10, 'Spoofed name', 'LITRES', 'USD', 'Preactivation bridge receipt'
  ) RETURNING id INTO log_id;
  PERFORM public.update_fuel_log_with_tank_entries(
    log_id, target_vessel_id,
    jsonb_build_object('comment', 'Preactivation bridge receipt'),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', main_id, 'amount_litres', 10
    ))
  );

  INSERT INTO public.fuel_transfers (
    vessel_id, source_tank_id, destination_tank_id, amount_litres,
    transfer_date, transfer_time, location, notes
  ) VALUES (
    target_vessel_id, main_id, day_id, 5, current_date, localtime::TIME,
    'Engine room', 'Preactivation bridge transfer'
  ) RETURNING id INTO transfer_id;

  IF (SELECT created_by_name FROM public.fuel_transfers WHERE id = transfer_id)
      <> 'Deleting Fuel HOD' THEN
    RAISE EXCEPTION 'Transfer creator name was not snapshotted by the server';
  END IF;

  effective_at := clock_timestamp();
  PERFORM public.activate_vessel_fuel_inventory(
    target_vessel_id, effective_at, 0::SMALLINT,
    jsonb_build_array(
      jsonb_build_object('fuel_tank_id', main_id, 'amount_litres', 100),
      jsonb_build_object('fuel_tank_id', day_id, 'amount_litres', 20)
    ),
    'Account deletion opening',
    'a5300000-0000-0000-0000-000000000001'
  );

  operation_result := public.record_fuel_inventory_entry(
    target_vessel_id, 'CONSUMPTION', clock_timestamp(), 0::SMALLINT,
    main_id, 2, 'Engine room', NULL, 'Account deletion consumption',
    'a5300000-0000-0000-0000-000000000002'
  );
  operation_id := (operation_result ->> 'id')::UUID;
  PERFORM public.void_fuel_inventory_entry(
    operation_id, 1, 'Account deletion void fixture',
    'a5300000-0000-0000-0000-000000000003'
  );

  effective_at := clock_timestamp();
  PERFORM public.update_fuel_log_with_tank_entries(
    log_id, target_vessel_id,
    jsonb_build_object(
      'expected_revision', 0,
      'client_request_id', 'a5300000-0000-0000-0000-000000000004',
      'amendment_reason', 'Account deletion receipt amendment',
      'effective_at', effective_at,
      'utc_offset_minutes', 0,
      'log_date', (effective_at AT TIME ZONE 'UTC')::DATE,
      'log_time', (effective_at AT TIME ZONE 'UTC')::TIME,
      'amount_of_fuel', 8, 'total_price', 8,
      'comment', 'Amended before account deletion'
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', day_id, 'amount_litres', 8
    ))
  );
  PERFORM public.void_fuel_log(
    log_id, 1, 'Account deletion receipt void',
    'a5300000-0000-0000-0000-000000000005'
  );

  effective_at := clock_timestamp();
  PERFORM public.amend_fuel_transfer(
    transfer_id, 0,
    jsonb_build_object(
      'source_tank_id', main_id, 'destination_tank_id', day_id,
      'amount_litres', 4, 'effective_at', effective_at,
      'utc_offset_minutes', 0,
      'transfer_date', (effective_at AT TIME ZONE 'UTC')::DATE,
      'transfer_time', (effective_at AT TIME ZONE 'UTC')::TIME,
      'location', 'Engine room', 'notes', 'Amended before account deletion'
    ),
    'Account deletion transfer amendment',
    'a5300000-0000-0000-0000-000000000006'
  );
  PERFORM public.void_fuel_transfer(
    transfer_id, 1, 'Account deletion transfer void',
    'a5300000-0000-0000-0000-000000000007'
  );

  INSERT INTO account_delete_fuel_fixture (fuel_log_id, fuel_transfer_id)
  VALUES (log_id, transfer_id);
END;
$$;

RESET ROLE;
UPDATE account_delete_fuel_fixture AS fixture
SET
  settings_snapshot = (
    SELECT to_jsonb(settings) - 'created_by' - 'updated_at'
    FROM public.vessel_fuel_settings AS settings
    WHERE settings.vessel_id = 'a1000000-0000-0000-0000-000000000004'
  ),
  tanks_snapshot = (
    SELECT jsonb_agg(to_jsonb(tank) - 'created_by' - 'updated_at' ORDER BY tank.id)
    FROM public.fuel_tanks AS tank
    WHERE tank.vessel_id = 'a1000000-0000-0000-0000-000000000004'
  ),
  fuel_log_snapshot = (
    SELECT to_jsonb(fuel_log) - 'created_by' - 'voided_by' - 'updated_at'
    FROM public.fuel_logs AS fuel_log WHERE fuel_log.id = fixture.fuel_log_id
  ),
  fuel_transfer_snapshot = (
    SELECT to_jsonb(transfer) - 'created_by' - 'voided_by' - 'updated_at'
    FROM public.fuel_transfers AS transfer WHERE transfer.id = fixture.fuel_transfer_id
  ),
  operations_snapshot = (
    SELECT jsonb_agg(to_jsonb(operation) - 'created_by' ORDER BY operation.recorded_sequence)
    FROM public.fuel_inventory_operations AS operation
    WHERE operation.vessel_id = 'a1000000-0000-0000-0000-000000000004'
  ),
  postings_snapshot = (
    SELECT jsonb_agg(to_jsonb(posting) ORDER BY posting.id)
    FROM public.fuel_inventory_postings AS posting
    WHERE posting.vessel_id = 'a1000000-0000-0000-0000-000000000004'
  ),
  voids_snapshot = (
    SELECT jsonb_agg(to_jsonb(voided) - 'created_by' ORDER BY voided.audit_sequence)
    FROM public.fuel_inventory_voids AS voided
    WHERE voided.vessel_id = 'a1000000-0000-0000-0000-000000000004'
  ),
  audits_snapshot = (
    SELECT jsonb_agg(to_jsonb(audit) - 'created_by' ORDER BY audit.recorded_at, audit.id)
    FROM public.fuel_inventory_legacy_source_audits AS audit
    WHERE audit.vessel_id = 'a1000000-0000-0000-0000-000000000004'
  ),
  request_results_snapshot = (
    SELECT jsonb_agg(to_jsonb(request_result) - 'created_by'
      ORDER BY request_result.client_request_id)
    FROM public.fuel_inventory_request_results AS request_result
    WHERE request_result.vessel_id = 'a1000000-0000-0000-0000-000000000004'
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM account_delete_fuel_fixture
    WHERE settings_snapshot IS NULL OR tanks_snapshot IS NULL
      OR fuel_log_snapshot IS NULL OR fuel_transfer_snapshot IS NULL
      OR operations_snapshot IS NULL OR postings_snapshot IS NULL
      OR voids_snapshot IS NULL OR audits_snapshot IS NULL
      OR request_results_snapshot IS NULL
  ) THEN
    RAISE EXCEPTION 'Account-deletion fixture snapshots are incomplete';
  END IF;
END;
$$;

SET ROLE service_role;
DO $$
DECLARE
  deletion_result JSONB;
BEGIN
  deletion_result := public.admin_prepare_account_deletion(
    'a2000000-0000-0000-0000-000000000009'
  );
  IF deletion_result ->> 'deleted_vessel_id' IS NOT NULL
    OR (deletion_result ->> 'profile_already_removed')::BOOLEAN THEN
    RAISE EXCEPTION 'Shared-vessel account deletion returned the wrong result';
  END IF;

  deletion_result := public.admin_prepare_account_deletion(
    'a2000000-0000-0000-0000-000000000009'
  );
  IF NOT (deletion_result ->> 'profile_already_removed')::BOOLEAN THEN
    RAISE EXCEPTION 'Account-deletion database phase is not safely retryable';
  END IF;
END;
$$;
RESET ROLE;

-- Mirrors delete-account/index.ts calling the Auth Admin API after its RPC.
DELETE FROM auth.users
WHERE id = 'a2000000-0000-0000-0000-000000000009';

DO $$
DECLARE
  fixture account_delete_fuel_fixture%ROWTYPE;
  target_vessel_id CONSTANT UUID := 'a1000000-0000-0000-0000-000000000004';
BEGIN
  SELECT * INTO STRICT fixture FROM account_delete_fuel_fixture;
  IF EXISTS (SELECT 1 FROM public.users
      WHERE id = 'a2000000-0000-0000-0000-000000000009')
    OR EXISTS (SELECT 1 FROM auth.users
      WHERE id = 'a2000000-0000-0000-0000-000000000009')
    OR NOT EXISTS (SELECT 1 FROM public.vessels WHERE id = target_vessel_id)
    OR NOT EXISTS (SELECT 1 FROM public.users
      WHERE id = 'a2000000-0000-0000-0000-000000000008') THEN
    RAISE EXCEPTION 'Two-phase shared-vessel account deletion removed the wrong rows';
  END IF;

  IF (SELECT to_jsonb(settings) - 'created_by' - 'updated_at'
      FROM public.vessel_fuel_settings AS settings
      WHERE settings.vessel_id = target_vessel_id)
      IS DISTINCT FROM fixture.settings_snapshot
    OR EXISTS (SELECT 1 FROM public.vessel_fuel_settings
      WHERE vessel_id = target_vessel_id AND created_by IS NOT NULL)
    OR (SELECT jsonb_agg(to_jsonb(tank) - 'created_by' - 'updated_at' ORDER BY tank.id)
      FROM public.fuel_tanks AS tank WHERE tank.vessel_id = target_vessel_id)
      IS DISTINCT FROM fixture.tanks_snapshot
    OR EXISTS (SELECT 1 FROM public.fuel_tanks
      WHERE vessel_id = target_vessel_id AND created_by IS NOT NULL) THEN
    RAISE EXCEPTION 'Fuel setup/tank FK cleanup changed business data';
  END IF;

  IF (SELECT to_jsonb(fuel_log) - 'created_by' - 'voided_by' - 'updated_at'
      FROM public.fuel_logs AS fuel_log WHERE fuel_log.id = fixture.fuel_log_id)
      IS DISTINCT FROM fixture.fuel_log_snapshot
    OR NOT EXISTS (SELECT 1 FROM public.fuel_logs
      WHERE id = fixture.fuel_log_id
        AND created_by IS NULL AND created_by_name = 'Deleting Fuel HOD'
        AND voided_by IS NULL AND voided_by_name = 'Deleting Fuel HOD') THEN
    RAISE EXCEPTION 'Fuel receipt attribution/evidence did not survive deletion';
  END IF;

  IF (SELECT to_jsonb(transfer) - 'created_by' - 'voided_by' - 'updated_at'
      FROM public.fuel_transfers AS transfer
      WHERE transfer.id = fixture.fuel_transfer_id)
      IS DISTINCT FROM fixture.fuel_transfer_snapshot
    OR NOT EXISTS (SELECT 1 FROM public.fuel_transfers
      WHERE id = fixture.fuel_transfer_id
        AND created_by IS NULL AND created_by_name = 'Deleting Fuel HOD'
        AND voided_by IS NULL AND voided_by_name = 'Deleting Fuel HOD') THEN
    RAISE EXCEPTION 'Fuel transfer attribution/evidence did not survive deletion';
  END IF;

  IF (SELECT jsonb_agg(to_jsonb(operation) - 'created_by'
        ORDER BY operation.recorded_sequence)
      FROM public.fuel_inventory_operations AS operation
      WHERE operation.vessel_id = target_vessel_id)
      IS DISTINCT FROM fixture.operations_snapshot
    OR EXISTS (SELECT 1 FROM public.fuel_inventory_operations
      WHERE vessel_id = target_vessel_id
        AND (created_by IS NOT NULL OR created_by_name <> 'Deleting Fuel HOD'))
    OR (SELECT jsonb_agg(to_jsonb(posting) ORDER BY posting.id)
      FROM public.fuel_inventory_postings AS posting
      WHERE posting.vessel_id = target_vessel_id)
      IS DISTINCT FROM fixture.postings_snapshot
    OR (SELECT jsonb_agg(to_jsonb(voided) - 'created_by' ORDER BY voided.audit_sequence)
      FROM public.fuel_inventory_voids AS voided
      WHERE voided.vessel_id = target_vessel_id)
      IS DISTINCT FROM fixture.voids_snapshot
    OR EXISTS (SELECT 1 FROM public.fuel_inventory_voids
      WHERE vessel_id = target_vessel_id
        AND (created_by IS NOT NULL OR created_by_name <> 'Deleting Fuel HOD')) THEN
    RAISE EXCEPTION 'Activated ledger evidence changed during account deletion';
  END IF;

  IF jsonb_array_length(fixture.audits_snapshot) <> 4
    OR (SELECT jsonb_agg(to_jsonb(audit) - 'created_by' ORDER BY audit.recorded_at, audit.id)
      FROM public.fuel_inventory_legacy_source_audits AS audit
      WHERE audit.vessel_id = target_vessel_id)
      IS DISTINCT FROM fixture.audits_snapshot
    OR EXISTS (SELECT 1 FROM public.fuel_inventory_legacy_source_audits
      WHERE vessel_id = target_vessel_id
        AND (created_by IS NOT NULL OR created_by_name <> 'Deleting Fuel HOD')) THEN
    RAISE EXCEPTION 'Private legacy audit evidence changed during account deletion';
  END IF;

  IF (SELECT jsonb_agg(to_jsonb(request_result) - 'created_by'
        ORDER BY request_result.client_request_id)
      FROM public.fuel_inventory_request_results AS request_result
      WHERE request_result.vessel_id = target_vessel_id)
      IS DISTINCT FROM fixture.request_results_snapshot
    OR EXISTS (SELECT 1 FROM public.fuel_inventory_request_results
      WHERE vessel_id = target_vessel_id AND created_by IS NOT NULL) THEN
    RAISE EXCEPTION 'Private idempotency evidence changed during account deletion';
  END IF;
END;
$$;

-- Deleting the final member takes the other application branch: the vessel and
-- every public/private fuel row intentionally cascade away. Ledger immutability
-- guards and restrictive tank references must not block that cleanup.
SET ROLE service_role;
DO $$
DECLARE
  deletion_result JSONB;
BEGIN
  deletion_result := public.admin_prepare_account_deletion(
    'a2000000-0000-0000-0000-000000000008'
  );
  IF deletion_result ->> 'deleted_vessel_id'
      <> 'a1000000-0000-0000-0000-000000000004' THEN
    RAISE EXCEPTION 'Final-member account deletion did not delete its vessel';
  END IF;
END;
$$;
RESET ROLE;
DELETE FROM auth.users
WHERE id = 'a2000000-0000-0000-0000-000000000008';

DO $$
DECLARE
  target_vessel_id CONSTANT UUID := 'a1000000-0000-0000-0000-000000000004';
BEGIN
  IF EXISTS (SELECT 1 FROM public.vessels WHERE id = target_vessel_id)
    OR EXISTS (SELECT 1 FROM public.vessel_fuel_settings WHERE vessel_id = target_vessel_id)
    OR EXISTS (SELECT 1 FROM public.fuel_tanks WHERE vessel_id = target_vessel_id)
    OR EXISTS (SELECT 1 FROM public.fuel_logs WHERE vessel_id = target_vessel_id)
    OR EXISTS (SELECT 1 FROM public.fuel_log_tank_entries WHERE vessel_id = target_vessel_id)
    OR EXISTS (SELECT 1 FROM public.fuel_transfers WHERE vessel_id = target_vessel_id)
    OR EXISTS (SELECT 1 FROM public.fuel_inventory_operations WHERE vessel_id = target_vessel_id)
    OR EXISTS (SELECT 1 FROM public.fuel_inventory_postings WHERE vessel_id = target_vessel_id)
    OR EXISTS (SELECT 1 FROM public.fuel_inventory_voids WHERE vessel_id = target_vessel_id)
    OR EXISTS (SELECT 1 FROM public.fuel_inventory_request_results WHERE vessel_id = target_vessel_id)
    OR EXISTS (SELECT 1 FROM public.fuel_inventory_legacy_source_audits WHERE vessel_id = target_vessel_id)
    OR EXISTS (SELECT 1 FROM public.users
      WHERE id = 'a2000000-0000-0000-0000-000000000008')
    OR EXISTS (SELECT 1 FROM auth.users
      WHERE id = 'a2000000-0000-0000-0000-000000000008') THEN
    RAISE EXCEPTION 'Final-member deletion did not cascade all vessel fuel data';
  END IF;
END;
$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000004', false);

-- Simulate a retained transfer created by the old client before activation.
-- After activation it remains an editable/voidable report row, but never
-- becomes an inventory operation.
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.fuel_inventory_legacy_source_audits AS audit_row
    WHERE audit_row.source_id = (
      SELECT id
      FROM public.fuel_logs
      WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
        AND location_of_refueling = 'Legacy quay'
    )
  ) THEN
    RAISE EXCEPTION 'Installed-client receipt update unexpectedly created an audit row';
  END IF;
END;
$$;
INSERT INTO public.fuel_logs (
  id, vessel_id, location_of_refueling, log_date, log_time,
  amount_of_fuel, price_per_gallon, total_price
) VALUES (
  'a7000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000002',
  'Old paper log', current_date, localtime::TIME,
  12.5, 2, 25
);
CREATE TEMP TABLE legacy_transfer_fixture (transfer_id UUID NOT NULL) ON COMMIT DROP;
WITH inserted AS (
  INSERT INTO public.fuel_transfers (
    vessel_id, source_tank_id, destination_tank_id, amount_litres,
    transfer_date, transfer_time, location, notes
  ) VALUES (
    'a1000000-0000-0000-0000-000000000002',
    (SELECT id FROM public.fuel_tanks WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002' AND name = 'Legacy Tank'),
    (SELECT id FROM public.fuel_tanks WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002' AND name = 'Legacy Day Tank'),
    5, current_date, localtime::TIME, 'Legacy engine room', 'Pre-ledger transfer'
  ) RETURNING id
)
INSERT INTO legacy_transfer_fixture SELECT id FROM inserted;
GRANT SELECT ON legacy_transfer_fixture TO authenticated;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000004', false);

-- A pre-foundation receipt can have no tank allocations and no reliable unit
-- marker.  Metadata-only correction keeps both facts intact and auditable;
-- a later explicit allocation upgrade remains supported as report history.
DO $$
DECLARE
  log_id CONSTANT UUID := 'a7000000-0000-0000-0000-000000000001';
  legacy_tank_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND name = 'Legacy Tank');
  metadata_patch JSONB := jsonb_build_object(
    'expected_revision', 0,
    'client_request_id', 'a5100000-0000-0000-0000-000000000001',
    'amendment_reason', 'Correct unallocated legacy metadata',
    'location_of_refueling', 'Corrected legacy dock',
    'comment', 'Metadata corrected',
    'price_per_gallon', 2.25,
    'total_price', 28.13
  );
  metadata_result JSONB;
  allocation_result JSONB;
  audits JSONB;
  rejected BOOLEAN := FALSE;
  allocation_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  metadata_result := public.update_fuel_log_with_tank_entries(
    log_id, 'a1000000-0000-0000-0000-000000000002',
    metadata_patch, '[]'::JSONB
  );
  PERFORM public.update_fuel_log_with_tank_entries(
    log_id, 'a1000000-0000-0000-0000-000000000002',
    metadata_patch, '[]'::JSONB
  );
  IF (metadata_result ->> 'inventory_revision')::INTEGER <> 1
    OR (metadata_result ->> 'amount_of_fuel')::NUMERIC <> 12.5
    OR metadata_result ->> 'volume_unit' IS NOT NULL
    OR metadata_result ->> 'effective_at' IS NOT NULL
    OR metadata_result ->> 'utc_offset_minutes' IS NOT NULL
    OR metadata_result ->> 'location_of_refueling'
      IS DISTINCT FROM 'Corrected legacy dock'
    OR EXISTS (SELECT 1 FROM public.fuel_log_tank_entries
      WHERE fuel_log_id = log_id) THEN
    RAISE EXCEPTION 'Metadata-only legacy receipt correction changed inventory semantics';
  END IF;

  BEGIN
    PERFORM public.update_fuel_log_with_tank_entries(
      log_id, 'a1000000-0000-0000-0000-000000000002',
      jsonb_build_object(
        'expected_revision', 1,
        'client_request_id', 'a5100000-0000-0000-0000-000000000004',
        'amendment_reason', 'Invalid unknown-time date edit',
        'log_date', current_date + 1
      ),
      '[]'::JSONB
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%require an effective time and UTC offset%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Unknown-time legacy receipt changed event date without UTC evidence';
  END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.update_fuel_log_with_tank_entries(
      log_id, 'a1000000-0000-0000-0000-000000000002',
      jsonb_build_object(
        'expected_revision', 1,
        'client_request_id', 'a5100000-0000-0000-0000-000000000003',
        'amendment_reason', 'Invalid unallocated amount edit',
        'amount_of_fuel', 13
      ),
      '[]'::JSONB
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%may only change report metadata%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Unallocated legacy receipt amount changed without allocations';
  END IF;

  allocation_result := public.update_fuel_log_with_tank_entries(
    log_id, 'a1000000-0000-0000-0000-000000000002',
    jsonb_build_object(
      'expected_revision', 1,
      'client_request_id', 'a5100000-0000-0000-0000-000000000002',
      'amendment_reason', 'Add verified allocation to legacy receipt',
      'effective_at', allocation_at,
      'utc_offset_minutes', 0,
      'log_date', (allocation_at AT TIME ZONE 'UTC')::DATE,
      'log_time', (allocation_at AT TIME ZONE 'UTC')::TIME,
      'amount_of_fuel', 12.5,
      'volume_unit', 'LITRES'
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', legacy_tank_id, 'amount_litres', 12.5
    ))
  );
  IF (allocation_result ->> 'inventory_revision')::INTEGER <> 2
    OR allocation_result ->> 'volume_unit' <> 'LITRES'
    OR (SELECT count(*) FROM public.fuel_log_tank_entries
        WHERE fuel_log_id = log_id) <> 1
    OR EXISTS (SELECT 1 FROM public.fuel_inventory_operations
        WHERE source_fuel_log_id = log_id) THEN
    RAISE EXCEPTION 'Legacy unallocated receipt could not adopt verified allocations';
  END IF;

  audits := public.get_fuel_inventory_legacy_audits(
    'a1000000-0000-0000-0000-000000000002',
    'FUEL_LOG', log_id, 10, NULL, NULL
  );
  IF jsonb_array_length(audits -> 'audits') <> 2
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(audits -> 'audits') AS audit
      WHERE audit ->> 'reason' = 'Correct unallocated legacy metadata'
        AND jsonb_array_length(audit #> '{before_snapshot,allocations}') = 0
        AND jsonb_array_length(audit #> '{after_snapshot,allocations}') = 0
        AND audit #>> '{before_snapshot,volume_unit}' IS NULL
        AND audit #>> '{after_snapshot,volume_unit}' IS NULL
        AND audit #>> '{before_snapshot,effective_at}' IS NULL
        AND audit #>> '{after_snapshot,effective_at}' IS NULL
        AND audit #>> '{before_snapshot,utc_offset_minutes}' IS NULL
        AND audit #>> '{after_snapshot,utc_offset_minutes}' IS NULL
        AND (audit #>> '{before_snapshot,inventory_revision}')::INTEGER = 0
        AND (audit #>> '{after_snapshot,inventory_revision}')::INTEGER = 1
    ) OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(audits -> 'audits') AS audit
      WHERE audit ->> 'reason' = 'Add verified allocation to legacy receipt'
        AND jsonb_array_length(audit #> '{before_snapshot,allocations}') = 0
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(audit #> '{after_snapshot,allocations}') AS allocation
          WHERE allocation ->> 'fuel_tank_id' = legacy_tank_id::TEXT
            AND allocation ->> 'tank_name' = 'Legacy Tank'
            AND (allocation ->> 'amount_litres')::NUMERIC = 12.5
        )
    ) THEN
    RAISE EXCEPTION 'Unallocated legacy receipt audit evidence is incomplete: %', audits;
  END IF;
END;
$$;

-- Once a current client has created immutable amendment evidence, an installed
-- build cannot rewrite or delete the source row while the vessel is still in
-- the compatibility window.
DO $$
DECLARE
  log_id CONSTANT UUID := 'a7000000-0000-0000-0000-000000000001';
  before_record JSONB := (SELECT to_jsonb(fuel_log)
    FROM public.fuel_logs AS fuel_log WHERE fuel_log.id = log_id);
  rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE public.fuel_logs
    SET comment = 'Installed client audit rewrite attempt'
    WHERE id = log_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%audited fuel record requires the current app version%' THEN
      RAISE;
    END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Installed client rewrote an audited report-only receipt';
  END IF;

  rejected := FALSE;
  BEGIN
    DELETE FROM public.fuel_logs WHERE id = log_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%audited fuel record requires the current app version%' THEN
      RAISE;
    END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Installed client deleted an audited report-only receipt';
  END IF;

  IF (SELECT to_jsonb(fuel_log) FROM public.fuel_logs AS fuel_log
      WHERE fuel_log.id = log_id) IS DISTINCT FROM before_record THEN
    RAISE EXCEPTION 'Rejected installed-client write changed audited source evidence';
  END IF;
END;
$$;

SELECT public.activate_vessel_fuel_inventory(
  'a1000000-0000-0000-0000-000000000002',
  date_trunc('minute', clock_timestamp()), 0::SMALLINT,
  jsonb_build_array(
    jsonb_build_object('fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002' AND name = 'Legacy Tank'), 'amount_litres', 50),
    jsonb_build_object('fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002' AND name = 'Legacy Day Tank'), 'amount_litres', 0)
  ), 'Start ledger after retained reports',
  'a5000000-0000-0000-0000-000000000004'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.fuel_inventory_operations
      WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
        AND operation_type = 'OPENING') <> 1 THEN
    RAISE EXCEPTION 'Minute-granular immediate opening was rejected';
  END IF;
END;
$$;

-- Activation is the atomic kill switch for every installed-client write path.
-- Reads and the current audited RPCs remain available, but old direct DML,
-- the three-argument setup adapter, and the legacy receipt-update call shape
-- can no longer create report-only records after the opening boundary.
DO $$
DECLARE
  target_vessel_id CONSTANT UUID := 'a1000000-0000-0000-0000-000000000002';
  legacy_log_id UUID := (SELECT id FROM public.fuel_logs
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND location_of_refueling = 'Legacy quay');
  legacy_transfer_id UUID := (SELECT transfer_id FROM legacy_transfer_fixture);
  source_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND name = 'Legacy Tank');
  destination_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND name = 'Legacy Day Tank');
  rejected BOOLEAN;
BEGIN
  rejected := FALSE;
  BEGIN
    PERFORM public.save_vessel_fuel_setup(
      target_vessel_id,
      'LITRES',
      (SELECT jsonb_agg(jsonb_build_object(
        'id', tank.id,
        'name', tank.name,
        'location', tank.location,
        'description', tank.description,
        'capacity_litres', tank.capacity_litres
      ) ORDER BY lower(tank.name), tank.id)
      FROM public.fuel_tanks AS tank
      WHERE tank.vessel_id = target_vessel_id AND tank.archived_at IS NULL)
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%requires the current app version%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Old setup adapter changed activated inventory'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.update_fuel_log_with_tank_entries(
      legacy_log_id,
      target_vessel_id,
      jsonb_build_object('comment', 'Forbidden old-client edit'),
      jsonb_build_array(jsonb_build_object(
        'fuel_tank_id', source_id, 'amount_litres', 25
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%requires the current app version%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Old receipt update changed activated inventory'; END IF;

  rejected := FALSE;
  BEGIN
    INSERT INTO public.fuel_logs (
      vessel_id, location_of_refueling, log_date, log_time,
      amount_of_fuel, price_per_gallon, total_price, created_by_name,
      volume_unit, currency_code, comment
    ) VALUES (
      target_vessel_id, 'Forbidden direct receipt', current_date, localtime::TIME,
      1, 1, 1, 'Spoofed actor', 'LITRES', 'USD', 'Must roll back'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%through inventory RPCs%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Direct receipt insert crossed activation'; END IF;

  rejected := FALSE;
  BEGIN
    UPDATE public.fuel_logs SET comment = 'Forbidden direct edit'
    WHERE id = legacy_log_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%through inventory RPCs%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Direct receipt update crossed activation'; END IF;

  rejected := FALSE;
  BEGIN
    DELETE FROM public.fuel_logs WHERE id = legacy_log_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%through inventory RPCs%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Direct receipt delete crossed activation'; END IF;

  rejected := FALSE;
  BEGIN
    INSERT INTO public.fuel_transfers (
      vessel_id, source_tank_id, destination_tank_id, amount_litres,
      transfer_date, transfer_time, location, notes
    ) VALUES (
      target_vessel_id, source_id, destination_id, 1,
      current_date, localtime::TIME, 'Forbidden direct transfer', 'Must roll back'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%through inventory RPCs%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Direct transfer insert crossed activation'; END IF;

  rejected := FALSE;
  BEGIN
    UPDATE public.fuel_transfers
    SET vessel_id = target_vessel_id, notes = 'Forbidden direct edit'
    WHERE id = legacy_transfer_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%through inventory RPCs%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Direct transfer update crossed activation'; END IF;

  rejected := FALSE;
  BEGIN
    DELETE FROM public.fuel_transfers WHERE id = legacy_transfer_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%through inventory RPCs%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Direct transfer delete crossed activation'; END IF;
END;
$$;

-- Temporarily widen only this test transaction's transfer UPDATE policy so an
-- authenticated caller can reach the source-write trigger with both the active
-- source vessel and an inactive destination vessel. The trigger itself must
-- reject the move before downstream tank/FK validation; ordinary production
-- RLS is otherwise an additional barrier to this attack.
RESET ROLE;
CREATE POLICY "Test-only cross-vessel fuel transfer update"
  ON public.fuel_transfers FOR UPDATE TO authenticated
  USING (TRUE) WITH CHECK (TRUE);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000004', false);
DO $$
DECLARE
  rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE public.fuel_transfers
    SET vessel_id = 'a1000000-0000-0000-0000-000000000003'
    WHERE id = (SELECT transfer_id FROM legacy_transfer_fixture);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%cannot be moved between vessels%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Activated transfer escaped through an inactive vessel';
  END IF;
END;
$$;
RESET ROLE;
DROP POLICY "Test-only cross-vessel fuel transfer update" ON public.fuel_transfers;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000004', false);

-- Legacy receipt corrections are manager-only, replay-safe, soft-voided, and
-- retained as report history without inventing ledger movement.
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000005', false);
DO $$
DECLARE
  log_id UUID := (SELECT id FROM public.fuel_logs
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND location_of_refueling = 'Legacy quay');
  tank_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND name = 'Legacy Tank');
  rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.update_fuel_log_with_tank_entries(
      log_id, 'a1000000-0000-0000-0000-000000000002',
      jsonb_build_object(
        'expected_revision', 0,
        'client_request_id', 'a5000000-0000-0000-0000-000000000007',
        'amendment_reason', 'Unauthorized legacy edit',
        'amount_of_fuel', 20, 'total_price', 20
      ),
      jsonb_build_array(jsonb_build_object(
        'fuel_tank_id', tank_id, 'amount_litres', 20
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Only an HOD or Captain/MOV%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Crew amended a legacy receipt'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.void_fuel_log(
      log_id, 0, 'Unauthorized legacy void',
      'a5000000-0000-0000-0000-000000000008'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Only an HOD or Captain/MOV%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Crew voided a legacy receipt'; END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000004', false);
DO $$
DECLARE
  log_id UUID := (SELECT id FROM public.fuel_logs
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND location_of_refueling = 'Legacy quay');
  tank_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND name = 'Legacy Day Tank');
  amendment_at TIMESTAMPTZ := clock_timestamp();
  amendment_offset CONSTANT SMALLINT := 540;
  patch JSONB := jsonb_build_object(
    'expected_revision', 0,
    'client_request_id', 'a5000000-0000-0000-0000-000000000007',
    'amendment_reason', 'Correct legacy receipt report',
    'amount_of_fuel', 20, 'total_price', 20,
    'log_date', ((amendment_at AT TIME ZONE 'UTC')
      + make_interval(mins => amendment_offset))::DATE,
    'log_time', ((amendment_at AT TIME ZONE 'UTC')
      + make_interval(mins => amendment_offset))::TIME,
    'effective_at', amendment_at,
    'utc_offset_minutes', amendment_offset
  );
  entries JSONB := jsonb_build_array(jsonb_build_object(
    'fuel_tank_id', tank_id, 'amount_litres', 20
  ));
  amended JSONB;
  voided JSONB;
  audit_page JSONB;
BEGIN
  amended := public.update_fuel_log_with_tank_entries(
    log_id, 'a1000000-0000-0000-0000-000000000002', patch, entries
  );
  PERFORM public.update_fuel_log_with_tank_entries(
    log_id, 'a1000000-0000-0000-0000-000000000002', patch, entries
  );
  audit_page := public.get_fuel_inventory_legacy_audits(
    'a1000000-0000-0000-0000-000000000002',
    'FUEL_LOG', log_id, 10, NULL, NULL
  );
  IF amended ->> 'current_inventory_operation_id' IS NOT NULL
    OR (amended ->> 'inventory_revision')::INTEGER <> 1
    OR (amended ->> 'effective_at')::TIMESTAMPTZ IS DISTINCT FROM amendment_at
    OR (amended ->> 'utc_offset_minutes')::SMALLINT <> amendment_offset
    OR (SELECT effective_at FROM public.fuel_logs WHERE id = log_id)
      IS DISTINCT FROM amendment_at
    OR EXISTS (SELECT 1 FROM public.fuel_inventory_operations
      WHERE source_fuel_log_id = log_id)
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(audit_page -> 'audits') AS audit_item
      WHERE audit_item ->> 'source_type' = 'FUEL_LOG'
        AND audit_item ->> 'source_id' = log_id::TEXT
        AND audit_item ->> 'action' = 'AMENDMENT'
        AND audit_item #>> '{before_snapshot,effective_at}' IS NOT NULL
        AND (audit_item #>> '{after_snapshot,effective_at}')::TIMESTAMPTZ
          IS NOT DISTINCT FROM amendment_at
        AND (audit_item #>> '{after_snapshot,utc_offset_minutes}')::SMALLINT
          = amendment_offset
    ) THEN
    RAISE EXCEPTION 'Legacy receipt amendment changed inventory history';
  END IF;

  voided := public.void_fuel_log(
    log_id, 1, 'Remove legacy receipt report',
    'a5000000-0000-0000-0000-000000000008'
  );
  PERFORM public.void_fuel_log(
    log_id, 1, 'Remove legacy receipt report',
    'a5000000-0000-0000-0000-000000000008'
  );
  IF voided ->> 'voided_at' IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.fuel_logs WHERE id = log_id) THEN
    RAISE EXCEPTION 'Legacy receipt void was not retained and replay-safe';
  END IF;
END;
$$;

DO $$
DECLARE
  transfer_id UUID := (SELECT legacy_transfer_fixture.transfer_id FROM legacy_transfer_fixture);
  effective_at TIMESTAMPTZ := clock_timestamp();
  payload JSONB;
  amended JSONB;
  voided JSONB;
  audit_page JSONB;
BEGIN
  payload := jsonb_build_object(
    'source_tank_id', (SELECT id FROM public.fuel_tanks WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002' AND name = 'Legacy Tank'),
    'destination_tank_id', (SELECT id FROM public.fuel_tanks WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002' AND name = 'Legacy Day Tank'),
    'amount_litres', 4, 'effective_at', effective_at,
    'utc_offset_minutes', 0,
    'transfer_date', (effective_at AT TIME ZONE 'UTC')::DATE,
    'transfer_time', (effective_at AT TIME ZONE 'UTC')::TIME,
    'location', 'Legacy engine room', 'notes', 'Corrected report only'
  );
  amended := public.amend_fuel_transfer(
    transfer_id, 0, payload, 'Correct legacy report',
    'a5000000-0000-0000-0000-000000000005'
  );
  PERFORM public.amend_fuel_transfer(
    transfer_id, 0, payload, 'Correct legacy report',
    'a5000000-0000-0000-0000-000000000005'
  );
  audit_page := public.get_fuel_inventory_legacy_audits(
    'a1000000-0000-0000-0000-000000000002',
    'FUEL_TRANSFER', transfer_id, 10, NULL, NULL
  );
  IF amended ->> 'current_inventory_operation_id' IS NOT NULL
    OR (amended ->> 'inventory_revision')::INTEGER <> 1
    OR (amended ->> 'effective_at')::TIMESTAMPTZ IS DISTINCT FROM effective_at
    OR (amended ->> 'utc_offset_minutes')::SMALLINT <> 0
    OR (SELECT transfer.effective_at FROM public.fuel_transfers AS transfer
      WHERE transfer.id = transfer_id)
      IS DISTINCT FROM effective_at
    OR EXISTS (SELECT 1 FROM public.fuel_inventory_operations
      WHERE source_fuel_transfer_id = transfer_id)
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(audit_page -> 'audits') AS audit_item
      WHERE audit_item ->> 'source_type' = 'FUEL_TRANSFER'
        AND audit_item ->> 'source_id' = transfer_id::TEXT
        AND audit_item ->> 'action' = 'AMENDMENT'
        AND audit_item #>> '{before_snapshot,effective_at}' IS NULL
        AND (audit_item #>> '{after_snapshot,effective_at}')::TIMESTAMPTZ
          IS NOT DISTINCT FROM effective_at
        AND (audit_item #>> '{after_snapshot,utc_offset_minutes}')::SMALLINT = 0
    ) THEN
    RAISE EXCEPTION 'Legacy transfer amendment changed inventory history';
  END IF;

  voided := public.void_fuel_transfer(
    transfer_id, 1, 'Remove legacy report',
    'a5000000-0000-0000-0000-000000000006'
  );
  PERFORM public.void_fuel_transfer(
    transfer_id, 1, 'Remove legacy report',
    'a5000000-0000-0000-0000-000000000006'
  );
  IF voided ->> 'voided_at' IS NULL
    OR EXISTS (SELECT 1 FROM public.fuel_inventory_voids
      WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'Legacy transfer void mutated ledger history';
  END IF;
END;
$$;

-- Vessel members can page immutable legacy correction evidence without direct
-- access to the private audit table.  Cursor ordering remains stable even when
-- multiple audit rows share a recorded_at value.
DO $$
DECLARE
  log_id UUID := (SELECT id FROM public.fuel_logs
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND location_of_refueling = 'Legacy quay');
  first_page JSONB;
  second_page JSONB;
  filtered_page JSONB;
  distinct_ids INTEGER;
BEGIN
  first_page := public.get_fuel_inventory_legacy_audits(
    'a1000000-0000-0000-0000-000000000002', NULL, NULL, 3, NULL, NULL
  );
  IF jsonb_array_length(first_page -> 'audits') <> 3
    OR first_page -> 'next_cursor' = 'null'::JSONB THEN
    RAISE EXCEPTION 'Legacy audit first page is incomplete: %', first_page;
  END IF;

  second_page := public.get_fuel_inventory_legacy_audits(
    'a1000000-0000-0000-0000-000000000002', NULL, NULL, 3,
    (first_page #>> '{next_cursor,recorded_at}')::TIMESTAMPTZ,
    (first_page #>> '{next_cursor,id}')::UUID
  );
  IF jsonb_array_length(second_page -> 'audits') <> 3
    OR second_page -> 'next_cursor' <> 'null'::JSONB THEN
    RAISE EXCEPTION 'Legacy audit second page is incomplete: %', second_page;
  END IF;

  SELECT count(DISTINCT audit ->> 'id') INTO distinct_ids
  FROM (
    SELECT jsonb_array_elements(first_page -> 'audits') AS audit
    UNION ALL
    SELECT jsonb_array_elements(second_page -> 'audits') AS audit
  ) AS combined;
  IF distinct_ids <> 6 THEN
    RAISE EXCEPTION 'Legacy audit pagination repeated or omitted rows';
  END IF;

  filtered_page := public.get_fuel_inventory_legacy_audits(
    'a1000000-0000-0000-0000-000000000002',
    'fuel_log', log_id, 10, NULL, NULL
  );
  IF jsonb_array_length(filtered_page -> 'audits') <> 2
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(filtered_page -> 'audits') AS audit
      WHERE audit ->> 'source_type' <> 'FUEL_LOG'
        OR audit ->> 'source_id' <> log_id::TEXT
        OR NOT (audit ?& ARRAY[
          'revision_before', 'revision_after', 'before_snapshot',
          'after_snapshot', 'reason', 'created_by',
          'created_by_name', 'recorded_at'
        ])
    ) THEN
    RAISE EXCEPTION 'Legacy audit filter/shape is incorrect: %', filtered_page;
  END IF;
END;
$$;

RESET ROLE;
DO $$
DECLARE
  transfer_id UUID := (SELECT legacy_transfer_fixture.transfer_id FROM legacy_transfer_fixture);
  log_id UUID := (SELECT id FROM public.fuel_logs
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000002'
      AND location_of_refueling = 'Legacy quay');
  amendment public.fuel_inventory_legacy_source_audits%ROWTYPE;
BEGIN
  IF (SELECT count(*) FROM public.fuel_inventory_legacy_source_audits
      WHERE source_type = 'FUEL_TRANSFER' AND source_id = transfer_id) <> 2 THEN
    RAISE EXCEPTION 'Legacy transfer correction audit is incomplete';
  END IF;
  SELECT * INTO amendment
  FROM public.fuel_inventory_legacy_source_audits
  WHERE source_type = 'FUEL_TRANSFER' AND source_id = transfer_id
    AND action = 'AMENDMENT';
  IF (amendment.before_snapshot ->> 'amount_litres')::NUMERIC <> 5
    OR (amendment.after_snapshot ->> 'amount_litres')::NUMERIC <> 4
    OR amendment.before_snapshot ->> 'source_tank_name'
      IS DISTINCT FROM 'Legacy Tank'
    OR amendment.before_snapshot ->> 'destination_tank_name'
      IS DISTINCT FROM 'Legacy Day Tank'
    OR amendment.after_snapshot ->> 'source_tank_name'
      IS DISTINCT FROM 'Legacy Tank'
    OR amendment.after_snapshot ->> 'destination_tank_name'
      IS DISTINCT FROM 'Legacy Day Tank'
    OR amendment.reason <> 'Correct legacy report' THEN
    RAISE EXCEPTION 'Legacy transfer amendment did not retain before/after audit';
  END IF;

  IF (SELECT count(*) FROM public.fuel_inventory_legacy_source_audits
      WHERE source_type = 'FUEL_LOG' AND source_id = log_id) <> 2 THEN
    RAISE EXCEPTION 'Legacy receipt correction audit is incomplete';
  END IF;
  SELECT * INTO amendment
  FROM public.fuel_inventory_legacy_source_audits
  WHERE source_type = 'FUEL_LOG' AND source_id = log_id
    AND action = 'AMENDMENT';
  IF (amendment.before_snapshot ->> 'amount_of_fuel')::NUMERIC <> 25
    OR (amendment.after_snapshot ->> 'amount_of_fuel')::NUMERIC <> 20
    OR (amendment.before_snapshot ->> 'inventory_revision')::INTEGER
      IS DISTINCT FROM 0
    OR (amendment.after_snapshot ->> 'inventory_revision')::INTEGER
      IS DISTINCT FROM 1
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        amendment.before_snapshot -> 'allocations'
      ) AS allocation
      WHERE allocation ->> 'tank_name' = 'Legacy Tank'
        AND (allocation ->> 'amount_litres')::NUMERIC = 25
        AND allocation ->> 'fuel_tank_id' IS NOT NULL
    )
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        amendment.after_snapshot -> 'allocations'
      ) AS allocation
      WHERE allocation ->> 'tank_name' = 'Legacy Day Tank'
        AND (allocation ->> 'amount_litres')::NUMERIC = 20
        AND allocation ->> 'fuel_tank_id' IS NOT NULL
    )
    OR amendment.reason <> 'Correct legacy receipt report' THEN
    RAISE EXCEPTION 'Legacy receipt amendment did not retain before/after audit';
  END IF;
END;
$$;
SET ROLE authenticated;

SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000001', false);

SELECT public.save_vessel_fuel_setup(
  'a1000000-0000-0000-0000-000000000001',
  'LITRES',
  '[
    {"name":"Main Tank","location":"Engine room","capacity_litres":1000},
    {"name":"Day Tank","location":"Machinery space","capacity_litres":500}
  ]'::jsonb,
  0,
  'a5000000-0000-0000-0000-000000000010'
);
SELECT public.save_vessel_fuel_setup(
  'a1000000-0000-0000-0000-000000000001',
  'LITRES',
  '[
    {"name":"Main Tank","location":"Engine room","capacity_litres":1000},
    {"name":"Day Tank","location":"Machinery space","capacity_litres":500}
  ]'::jsonb,
  0,
  'a5000000-0000-0000-0000-000000000010'
);

CREATE TEMP TABLE fuel_inventory_test_clock (
  base_at TIMESTAMPTZ NOT NULL
) ON COMMIT DROP;
INSERT INTO fuel_inventory_test_clock VALUES (now());

-- The server, not the client, owns the activation boundary and time rules.
DO $$
DECLARE
  rejected BOOLEAN := FALSE;
  main_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank');
  day_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Day Tank');
BEGIN
  BEGIN
    PERFORM public.activate_vessel_fuel_inventory(
      'a1000000-0000-0000-0000-000000000001',
      clock_timestamp() + interval '1 day', 0::SMALLINT,
      jsonb_build_array(
        jsonb_build_object('fuel_tank_id', main_id, 'amount_litres', 500),
        jsonb_build_object('fuel_tank_id', day_id, 'amount_litres', 100)
      ), 'future opening', 'a4000000-0000-0000-0000-000000000001'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%cannot be in the future%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Future opening was accepted'; END IF;
END;
$$;

SELECT public.activate_vessel_fuel_inventory(
  'a1000000-0000-0000-0000-000000000001',
  (SELECT base_at FROM fuel_inventory_test_clock),
  0::SMALLINT,
  jsonb_build_array(
    jsonb_build_object(
      'fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
      'amount_litres', 500
    ),
    jsonb_build_object(
      'fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE name = 'Day Tank'),
      'amount_litres', 100
    )
  ),
  'Commissioning levels',
  'a4000000-0000-0000-0000-000000000002'
);

-- Lost-response retry: mutable state now says every tank is initialized, but
-- the exact request must still replay rather than fail that state check.
SELECT public.activate_vessel_fuel_inventory(
  'a1000000-0000-0000-0000-000000000001',
  (SELECT base_at FROM fuel_inventory_test_clock),
  0::SMALLINT,
  jsonb_build_array(
    jsonb_build_object(
      'fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
      'amount_litres', 500
    ),
    jsonb_build_object(
      'fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE name = 'Day Tank'),
      'amount_litres', 100
    )
  ),
  'Commissioning levels',
  'a4000000-0000-0000-0000-000000000002'
);

DO $$
DECLARE
  snapshot JSONB := public.get_fuel_inventory_snapshot(
    'a1000000-0000-0000-0000-000000000001', clock_timestamp()
  );
BEGIN
  IF (SELECT count(*) FROM public.fuel_inventory_operations
      WHERE operation_type = 'OPENING') <> 1 THEN
    RAISE EXCEPTION 'Activation retry duplicated the opening operation';
  END IF;
  IF (snapshot #>> '{status,activated}')::BOOLEAN IS NOT TRUE
    OR (snapshot #>> '{status,fully_initialized}')::BOOLEAN IS NOT TRUE
    OR (snapshot ->> 'total_balance_litres')::NUMERIC <> 600 THEN
    RAISE EXCEPTION 'Activated snapshot is inaccurate: %', snapshot;
  END IF;
  IF NOT ((snapshot -> 'tanks' -> 0) ?& ARRAY[
    'created_by', 'created_at', 'updated_at', 'initialized',
    'remaining_capacity_litres', 'last_verified_at',
    'last_verified_type', 'last_verified_utc_offset_minutes', 'last_activity_at'
  ]) THEN
    RAISE EXCEPTION 'Snapshot tank contract is incomplete: %', snapshot -> 'tanks' -> 0;
  END IF;
  IF (public.get_fuel_inventory_snapshot(
      'a1000000-0000-0000-0000-000000000001',
      (SELECT base_at - interval '1 microsecond' FROM fuel_inventory_test_clock)
    ) #>> '{status,activated}')::BOOLEAN IS TRUE THEN
    RAISE EXCEPTION 'Historical snapshot exposed activation before its boundary';
  END IF;
END;
$$;

-- Opening errors are corrected by atomic replacement, never by a pure void.
SELECT public.amend_fuel_inventory_opening(
  (SELECT id FROM public.fuel_inventory_operations
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000002'),
  1,
  (SELECT base_at FROM fuel_inventory_test_clock),
  0::SMALLINT,
  jsonb_build_array(
    jsonb_build_object(
      'fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
      'amount_litres', 520
    ),
    jsonb_build_object(
      'fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE name = 'Day Tank'),
      'amount_litres', 100
    )
  ),
  'Corrected commissioning dip',
  'Gauge transcription correction',
  'a4000000-0000-0000-0000-000000000003'
);

-- Exact amendment retry still uses expected revision 1 after revision advanced.
SELECT public.amend_fuel_inventory_opening(
  (SELECT id FROM public.fuel_inventory_operations
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000002'),
  1,
  (SELECT base_at FROM fuel_inventory_test_clock),
  0::SMALLINT,
  jsonb_build_array(
    jsonb_build_object(
      'fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
      'amount_litres', 520
    ),
    jsonb_build_object(
      'fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE name = 'Day Tank'),
      'amount_litres', 100
    )
  ),
  'Corrected commissioning dip',
  'Gauge transcription correction',
  'a4000000-0000-0000-0000-000000000003'
);

DO $$
DECLARE
  current_opening UUID := (SELECT id FROM public.fuel_inventory_operations
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000003');
  main_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank');
  rejected BOOLEAN := FALSE;
BEGIN
  IF (SELECT count(*) FROM public.fuel_inventory_operations
      WHERE logical_operation_id = (SELECT logical_operation_id
        FROM public.fuel_inventory_operations WHERE id = current_opening)) <> 2 THEN
    RAISE EXCEPTION 'Opening amendment retry duplicated a revision';
  END IF;
  BEGIN
    PERFORM public.amend_fuel_inventory_opening(
      current_opening, 2, (SELECT base_at FROM fuel_inventory_test_clock), 0::SMALLINT,
      jsonb_build_array(jsonb_build_object(
        'fuel_tank_id', main_id, 'amount_litres', 520
      )), 'bad set', 'Must reject changed tank set',
      'a4000000-0000-0000-0000-000000000004'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%preserve exactly the original tank set%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Opening amendment changed its tank set'; END IF;
END;
$$;

-- Activated receipt: local source date/time must agree with the canonical UTC
-- effective time. Creation, amendment, void, and exact retries are ledger-backed.
DO $$
DECLARE
  effective_at TIMESTAMPTZ := (SELECT base_at + interval '100 milliseconds'
    FROM fuel_inventory_test_clock);
  main_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank');
  first_result JSONB;
  retry_result JSONB;
  rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.create_fuel_log_with_tank_entries(
      jsonb_build_object(
        'vessel_id', 'a1000000-0000-0000-0000-000000000001',
        'log_date', (effective_at AT TIME ZONE 'UTC')::DATE,
        'log_time', (effective_at AT TIME ZONE 'UTC')::TIME,
        'amount_of_fuel', 1, 'price_per_gallon', 1, 'total_price', 1,
        'volume_unit', 'LITRES', 'currency_code', 'USD',
        'effective_at', effective_at, 'utc_offset_minutes', 0,
        'client_request_id', 'a4000000-0000-0000-0000-000000000086'
      ),
      '[]'::JSONB
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%At least one tank allocation is required%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Activated receipt accepted no allocations'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.create_fuel_log_with_tank_entries(
      jsonb_build_object(
        'vessel_id', 'a1000000-0000-0000-0000-000000000001',
        'log_date', (effective_at AT TIME ZONE 'UTC')::DATE,
        'log_time', (effective_at AT TIME ZONE 'UTC')::TIME,
        'amount_of_fuel', 1.0005, 'price_per_gallon', 1, 'total_price', 1,
        'volume_unit', 'LITRES', 'currency_code', 'USD',
        'effective_at', effective_at, 'utc_offset_minutes', 0,
        'client_request_id', 'a4000000-0000-0000-0000-000000000074'
      ),
      jsonb_build_array(jsonb_build_object(
        'fuel_tank_id', main_id, 'amount_litres', 1.0005
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%at most three decimal places%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Over-precision receipt was accepted'; END IF;

  first_result := public.create_fuel_log_with_tank_entries(
    jsonb_build_object(
      'vessel_id', 'a1000000-0000-0000-0000-000000000001',
      'location_of_refueling', 'Test Quay',
      'log_date', (effective_at AT TIME ZONE 'UTC')::DATE,
      'log_time', (effective_at AT TIME ZONE 'UTC')::TIME,
      'amount_of_fuel', 50,
      'price_per_gallon', 1,
      'total_price', 50,
      'volume_unit', 'LITRES',
      'currency_code', 'USD',
      'comment', 'Ledger receipt',
      'effective_at', effective_at,
      'utc_offset_minutes', 0,
      'client_request_id', 'a4000000-0000-0000-0000-000000000010'
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', main_id, 'amount_litres', 50
    ))
  );
  retry_result := public.create_fuel_log_with_tank_entries(
    jsonb_build_object(
      'vessel_id', 'a1000000-0000-0000-0000-000000000001',
      'location_of_refueling', 'Test Quay',
      'log_date', (effective_at AT TIME ZONE 'UTC')::DATE,
      'log_time', (effective_at AT TIME ZONE 'UTC')::TIME,
      'amount_of_fuel', 50, 'price_per_gallon', 1, 'total_price', 50,
      'volume_unit', 'LITRES', 'currency_code', 'USD',
      'comment', 'Ledger receipt', 'effective_at', effective_at,
      'utc_offset_minutes', 0,
      'client_request_id', 'a4000000-0000-0000-0000-000000000010'
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', main_id, 'amount_litres', 50
    ))
  );
  IF first_result ->> 'id' <> retry_result ->> 'id' THEN
    RAISE EXCEPTION 'Receipt idempotency returned a different source row';
  END IF;
END;
$$;

DO $$
DECLARE
  log_id UUID := (SELECT source_fuel_log_id FROM public.fuel_inventory_operations
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000010');
  main_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank');
  effective_at TIMESTAMPTZ := (SELECT base_at + interval '100 milliseconds'
    FROM fuel_inventory_test_clock);
  first_result JSONB;
  retry_result JSONB;
  rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.update_fuel_log_with_tank_entries(
      log_id, 'a1000000-0000-0000-0000-000000000001',
      jsonb_build_object(
        'expected_revision', 1,
        'client_request_id', 'a4000000-0000-0000-0000-000000000087',
        'amendment_reason', 'Invalid empty allocation probe',
        'effective_at', effective_at, 'utc_offset_minutes', 0,
        'amount_of_fuel', 50, 'total_price', 50
      ),
      '[]'::JSONB
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%At least one tank allocation is required%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Ledger receipt amendment removed all allocations'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.update_fuel_log_with_tank_entries(
      log_id, 'a1000000-0000-0000-0000-000000000001',
      jsonb_build_object(
        'expected_revision', 1,
        'client_request_id', 'a4000000-0000-0000-0000-000000000075',
        'amendment_reason', 'Invalid precision probe',
        'effective_at', effective_at, 'utc_offset_minutes', 0,
        'amount_of_fuel', 40.0005, 'total_price', 40
      ),
      jsonb_build_array(jsonb_build_object(
        'fuel_tank_id', main_id, 'amount_litres', 40.0005
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%at most three decimal places%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Over-precision receipt amendment was accepted'; END IF;

  first_result := public.update_fuel_log_with_tank_entries(
    log_id, 'a1000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'expected_revision', 1,
      'client_request_id', 'a4000000-0000-0000-0000-000000000011',
      'amendment_reason', 'Correct delivered quantity',
      'effective_at', effective_at,
      'utc_offset_minutes', 0,
      'amount_of_fuel', 40,
      'total_price', 40
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', main_id, 'amount_litres', 40
    ))
  );
  retry_result := public.update_fuel_log_with_tank_entries(
    log_id, 'a1000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'expected_revision', 1,
      'client_request_id', 'a4000000-0000-0000-0000-000000000011',
      'amendment_reason', 'Correct delivered quantity',
      'effective_at', effective_at,
      'utc_offset_minutes', 0,
      'amount_of_fuel', 40,
      'total_price', 40
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', main_id, 'amount_litres', 40
    ))
  );
  IF (retry_result ->> 'inventory_revision')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'Receipt amendment retry did not replay revision 2';
  END IF;
  PERFORM public.void_fuel_log(
    log_id, 2, 'Receipt entered against wrong bunker note',
    'a4000000-0000-0000-0000-000000000012'
  );
  PERFORM public.void_fuel_log(
    log_id, 2, 'Receipt entered against wrong bunker note',
    'a4000000-0000-0000-0000-000000000012'
  );
END;
$$;

-- US-gallon receipts use three-decimal normalized canonical litres; source,
-- allocation, and ledger values stay consistent across create and amendment.
DO $$
DECLARE
  effective_at TIMESTAMPTZ := (SELECT base_at + interval '150 milliseconds'
    FROM fuel_inventory_test_clock);
  main_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank');
  created JSONB;
  amended JSONB;
  log_id UUID;
  ledger_operation_id UUID;
BEGIN
  created := public.create_fuel_log_with_tank_entries(
    jsonb_build_object(
      'vessel_id', 'a1000000-0000-0000-0000-000000000001',
      'log_date', (effective_at AT TIME ZONE 'UTC')::DATE,
      'log_time', (effective_at AT TIME ZONE 'UTC')::TIME,
      'amount_of_fuel', 1, 'price_per_gallon', 1, 'total_price', 1,
      'volume_unit', 'US_GALLONS', 'currency_code', 'USD',
      'effective_at', effective_at, 'utc_offset_minutes', 0,
      'client_request_id', 'a4000000-0000-0000-0000-000000000076'
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', main_id, 'amount_litres', 3.785
    ))
  );
  log_id := (created ->> 'id')::UUID;
  amended := public.update_fuel_log_with_tank_entries(
    log_id, 'a1000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'expected_revision', 1,
      'client_request_id', 'a4000000-0000-0000-0000-000000000077',
      'amendment_reason', 'Normalized gallon correction',
      'effective_at', effective_at, 'utc_offset_minutes', 0,
      'amount_of_fuel', 2, 'total_price', 2
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', main_id, 'amount_litres', 7.571
    ))
  );
  ledger_operation_id := (amended ->> 'current_inventory_operation_id')::UUID;
  IF (SELECT amount_litres FROM public.fuel_log_tank_entries
      WHERE fuel_log_id = log_id) <> 7.571
    OR (SELECT posting.amount_litres FROM public.fuel_inventory_postings AS posting
      WHERE posting.operation_id = ledger_operation_id) <> 7.571 THEN
    RAISE EXCEPTION 'Normalized US-gallon receipt diverged from ledger';
  END IF;
  PERFORM public.void_fuel_log(
    log_id, 2, 'US gallon normalization fixture complete',
    'a4000000-0000-0000-0000-000000000078'
  );
END;
$$;

-- Transfer creation/amendment/void share the same chronological ledger and
-- remain replay-safe even when the expected revision is now stale.
DO $$
DECLARE
  effective_at TIMESTAMPTZ := (SELECT base_at + interval '200 milliseconds'
    FROM fuel_inventory_test_clock);
  main_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank');
  day_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Day Tank');
  first_result JSONB;
  retry_result JSONB;
  transfer_id UUID;
  transfer_payload JSONB;
BEGIN
  transfer_payload := jsonb_build_object(
    'vessel_id', 'a1000000-0000-0000-0000-000000000001',
    'source_tank_id', main_id, 'destination_tank_id', day_id,
    'amount_litres', 200, 'effective_at', effective_at,
    'utc_offset_minutes', 0,
    'transfer_date', (effective_at AT TIME ZONE 'UTC')::DATE,
    'transfer_time', (effective_at AT TIME ZONE 'UTC')::TIME,
    'location', 'Engine room', 'notes', 'Balance day tank'
  );
  first_result := public.record_fuel_transfer(
    transfer_payload, 'a4000000-0000-0000-0000-000000000020'
  );
  retry_result := public.record_fuel_transfer(
    transfer_payload, 'a4000000-0000-0000-0000-000000000020'
  );
  IF first_result ->> 'id' <> retry_result ->> 'id' THEN
    RAISE EXCEPTION 'Transfer idempotency returned a different source row';
  END IF;
  transfer_id := (first_result ->> 'id')::UUID;
  transfer_payload := transfer_payload || jsonb_build_object('amount_litres', 150);
  PERFORM public.amend_fuel_transfer(
    transfer_id, 1, transfer_payload, 'Correct transfer meter reading',
    'a4000000-0000-0000-0000-000000000021'
  );
  retry_result := public.amend_fuel_transfer(
    transfer_id, 1, transfer_payload, 'Correct transfer meter reading',
    'a4000000-0000-0000-0000-000000000021'
  );
  IF (retry_result ->> 'inventory_revision')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'Transfer amendment retry did not replay revision 2';
  END IF;
  PERFORM public.void_fuel_transfer(
    transfer_id, 2, 'Test reversal',
    'a4000000-0000-0000-0000-000000000022'
  );
  PERFORM public.void_fuel_transfer(
    transfer_id, 2, 'Test reversal',
    'a4000000-0000-0000-0000-000000000022'
  );
END;
$$;

-- Sounding is an absolute anchor; consumption and adjustment are signed
-- deltas. A later-inserted backdated movement must validate every prefix, not
-- only the final aggregate after the sounding anchor.
SELECT public.record_fuel_inventory_entry(
  'a1000000-0000-0000-0000-000000000001', 'SOUNDING',
  (SELECT base_at + interval '500 milliseconds' FROM fuel_inventory_test_clock),
  0::SMALLINT, (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
  450, 'Engine room', NULL, 'Verified dip',
  'a4000000-0000-0000-0000-000000000030'
);
SELECT public.record_fuel_inventory_entry(
  'a1000000-0000-0000-0000-000000000001', 'CONSUMPTION',
  (SELECT base_at + interval '600 milliseconds' FROM fuel_inventory_test_clock),
  0::SMALLINT, (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
  50, NULL, NULL, 'Generator use',
  'a4000000-0000-0000-0000-000000000031'
);
SELECT public.record_fuel_inventory_entry(
  'a1000000-0000-0000-0000-000000000001', 'ADJUSTMENT',
  (SELECT base_at + interval '700 milliseconds' FROM fuel_inventory_test_clock),
  0::SMALLINT, (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
  10, 'Engine room', 'Meter calibration', 'Approved correction',
  'a4000000-0000-0000-0000-000000000032'
);

DO $$
DECLARE
  rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.record_fuel_inventory_entry(
      'a1000000-0000-0000-0000-000000000001', 'CONSUMPTION',
      (SELECT base_at + interval '300 milliseconds' FROM fuel_inventory_test_clock),
      0::SMALLINT, (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
      700, NULL, NULL, 'Invalid backdated burn',
      'a4000000-0000-0000-0000-000000000033'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%balance negative%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Backdated negative prefix was accepted'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.record_fuel_inventory_entry(
      'a1000000-0000-0000-0000-000000000001', 'OPENING',
      clock_timestamp(), 0::SMALLINT,
      (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
      1, NULL, NULL, NULL,
      'a4000000-0000-0000-0000-000000000034'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%type is invalid%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Generic entry RPC accepted OPENING'; END IF;
END;
$$;

-- Crew can record ordinary activity but cannot create adjustments or correct
-- immutable audit history.
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000003', false);
SELECT public.record_fuel_inventory_entry(
  'a1000000-0000-0000-0000-000000000001', 'CONSUMPTION',
  (SELECT base_at + interval '800 milliseconds' FROM fuel_inventory_test_clock),
  0::SMALLINT, (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
  10, NULL, NULL, 'Crew-entered use',
  'a4000000-0000-0000-0000-000000000035'
);
DO $$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.amend_fuel_inventory_entry(
      (SELECT id FROM public.fuel_inventory_operations
        WHERE client_request_id = 'a4000000-0000-0000-0000-000000000030'),
      1, (SELECT base_at + interval '500 milliseconds' FROM fuel_inventory_test_clock),
      0::SMALLINT, 460, 'Engine room', NULL, 'Crew edit', 'Unauthorized correction',
      'a4000000-0000-0000-0000-000000000036'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Only an HOD or Captain/MOV%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Crew amended fuel inventory history'; END IF;
END;
$$;
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000001', false);

SELECT public.amend_fuel_inventory_entry(
  (SELECT id FROM public.fuel_inventory_operations
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000030'),
  1,
  (SELECT base_at + interval '500 milliseconds' FROM fuel_inventory_test_clock),
  0::SMALLINT, 460, 'Engine room', NULL, 'Verified corrected dip',
  'Correct sounding transcription',
  'a4000000-0000-0000-0000-000000000037'
);
SELECT public.amend_fuel_inventory_entry(
  (SELECT id FROM public.fuel_inventory_operations
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000030'),
  1,
  (SELECT base_at + interval '500 milliseconds' FROM fuel_inventory_test_clock),
  0::SMALLINT, 460, 'Engine room', NULL, 'Verified corrected dip',
  'Correct sounding transcription',
  'a4000000-0000-0000-0000-000000000037'
);

SELECT public.void_fuel_inventory_entry(
  (SELECT id FROM public.fuel_inventory_operations
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000032'),
  1, 'Adjustment duplicated in source notes',
  'a4000000-0000-0000-0000-000000000038'
);
SELECT public.void_fuel_inventory_entry(
  (SELECT id FROM public.fuel_inventory_operations
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000032'),
  1, 'Adjustment duplicated in source notes',
  'a4000000-0000-0000-0000-000000000038'
);

-- Add a tank after activation. Exactly the complete uninitialized set must be
-- opened atomically, while the vessel's original activation time is retained.
CREATE TEMP TABLE fuel_inventory_activation_stamp AS
SELECT inventory_activated_at
FROM public.vessel_fuel_settings
WHERE vessel_id = 'a1000000-0000-0000-0000-000000000001';

SELECT public.save_vessel_fuel_setup(
  'a1000000-0000-0000-0000-000000000001', 'LITRES',
  jsonb_build_array(
    jsonb_build_object('id', (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
      'name', 'Main Tank', 'location', 'Engine room', 'capacity_litres', 1000),
    jsonb_build_object('id', (SELECT id FROM public.fuel_tanks WHERE name = 'Day Tank'),
      'name', 'Day Tank', 'location', 'Machinery space', 'capacity_litres', 500),
    jsonb_build_object('name', 'Reserve Tank', 'location', 'Tank deck', 'capacity_litres', 300)
  ),
  1,
  'a5000000-0000-0000-0000-000000000011'
);

DO $$
DECLARE
  rejected BOOLEAN := FALSE;
  reserve_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Reserve Tank');
  main_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank');
BEGIN
  BEGIN
    PERFORM public.activate_vessel_fuel_inventory(
      'a1000000-0000-0000-0000-000000000001', clock_timestamp(), 0::SMALLINT,
      jsonb_build_array(
        jsonb_build_object('fuel_tank_id', reserve_id, 'amount_litres', 20),
        jsonb_build_object('fuel_tank_id', main_id, 'amount_litres', 1)
      ), 'extra initialized tank', 'a4000000-0000-0000-0000-000000000040'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%uninitialized active vessel tanks%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Later activation accepted an extra tank'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.activate_vessel_fuel_inventory(
      'a1000000-0000-0000-0000-000000000001', clock_timestamp(), 0::SMALLINT,
      '[]'::JSONB, 'missing tank', 'a4000000-0000-0000-0000-000000000041'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Opening levels are required%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Later activation accepted missing tanks'; END IF;
END;
$$;

SELECT public.activate_vessel_fuel_inventory(
  'a1000000-0000-0000-0000-000000000001',
  date_trunc('minute', clock_timestamp()), 0::SMALLINT,
  jsonb_build_array(jsonb_build_object(
    'fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE name = 'Reserve Tank'),
    'amount_litres', 20
  )), 'Initialize added reserve tank',
  'a4000000-0000-0000-0000-000000000042'
);
SELECT public.activate_vessel_fuel_inventory(
  'a1000000-0000-0000-0000-000000000001',
  (SELECT effective_at FROM public.fuel_inventory_operations
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000042'),
  0::SMALLINT,
  jsonb_build_array(jsonb_build_object(
    'fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE name = 'Reserve Tank'),
    'amount_litres', 20
  )), 'Initialize added reserve tank',
  'a4000000-0000-0000-0000-000000000042'
);

DO $$
BEGIN
  IF (SELECT inventory_activated_at FROM public.vessel_fuel_settings
      WHERE vessel_id = 'a1000000-0000-0000-0000-000000000001')
    IS DISTINCT FROM (SELECT inventory_activated_at FROM fuel_inventory_activation_stamp) THEN
    RAISE EXCEPTION 'Adding a tank changed the vessel activation timestamp';
  END IF;
  IF (public.get_fuel_inventory_snapshot(
      'a1000000-0000-0000-0000-000000000001', clock_timestamp()
    ) #>> '{status,fully_initialized}')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'Added tank was not fully initialized';
  END IF;
END;
$$;

-- Capacity edits replay historical peaks, and direct API writes cannot spoof
-- the internal GUC, clear activation, or manipulate tank lifecycle state.
DO $$
DECLARE
  rejected BOOLEAN := FALSE;
  main_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank');
  transfer_id UUID := (SELECT source_fuel_transfer_id
    FROM public.fuel_inventory_operations
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000020');
BEGIN
  BEGIN
    PERFORM public.save_vessel_fuel_setup(
      'a1000000-0000-0000-0000-000000000001', 'LITRES',
      (SELECT jsonb_agg(jsonb_build_object(
        'id', tank.id,
        'name', tank.name,
        'location', tank.location,
        'description', tank.description,
        'capacity_litres', CASE WHEN tank.id = main_id
          THEN 500 ELSE tank.capacity_litres END
      ) ORDER BY lower(tank.name), tank.id)
      FROM public.fuel_tanks AS tank
      WHERE tank.vessel_id = 'a1000000-0000-0000-0000-000000000001'
        AND tank.archived_at IS NULL),
      2,
      'a5000000-0000-0000-0000-000000000012'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%historical balance%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Capacity was reduced below a historical peak'; END IF;

  rejected := FALSE;
  BEGIN
    UPDATE public.fuel_tanks SET name = 'Direct bypass' WHERE id = main_id;
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'API client directly updated the tank catalogue'; END IF;

  PERFORM set_config('nautical.fuel_inventory_rpc', 'on', TRUE);
  rejected := FALSE;
  BEGIN
    UPDATE public.fuel_transfers SET notes = 'spoofed bypass' WHERE id = transfer_id;
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := TRUE;
  WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%requires the current app version%'
      AND SQLERRM NOT LIKE '%through inventory RPCs%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Custom GUC bypassed source-row guard'; END IF;

  rejected := FALSE;
  BEGIN
    UPDATE public.vessel_fuel_settings SET inventory_activated_at = NULL
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := TRUE;
  WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%through fuel setup and activation RPCs%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'API client cleared the activation boundary'; END IF;

  rejected := FALSE;
  BEGIN
    UPDATE public.fuel_tanks SET archived_at = clock_timestamp() WHERE id = main_id;
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'API client directly archived a tank'; END IF;

  rejected := FALSE;
  BEGIN
    UPDATE public.fuel_inventory_operations SET metadata = '{}'::JSONB
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000030';
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'API client updated append-only ledger rows'; END IF;
END;
$$;

-- Create retained receipt/transfer source rows that reference Day Tank. They
-- will be corrected after archival without allowing any new archived-tank use.
CREATE TEMP TABLE archived_source_fixture (
  fuel_log_id UUID NOT NULL,
  fuel_log_effective_at TIMESTAMPTZ NOT NULL,
  fuel_transfer_id UUID NOT NULL,
  fuel_transfer_effective_at TIMESTAMPTZ NOT NULL
) ON COMMIT DROP;
DO $$
DECLARE
  vessel_id CONSTANT UUID := 'a1000000-0000-0000-0000-000000000001';
  main_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank');
  day_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Day Tank');
  receipt_at TIMESTAMPTZ := clock_timestamp();
  transfer_at TIMESTAMPTZ;
  receipt JSONB;
  transfer JSONB;
BEGIN
  receipt := public.create_fuel_log_with_tank_entries(
    jsonb_build_object(
      'vessel_id', vessel_id,
      'location_of_refueling', 'Archive correction quay',
      'log_date', (receipt_at AT TIME ZONE 'UTC')::DATE,
      'log_time', (receipt_at AT TIME ZONE 'UTC')::TIME,
      'amount_of_fuel', 10, 'price_per_gallon', 1, 'total_price', 10,
      'volume_unit', 'LITRES', 'currency_code', 'USD',
      'comment', 'Retained archived-tank receipt',
      'effective_at', receipt_at, 'utc_offset_minutes', 0,
      'client_request_id', 'a4000000-0000-0000-0000-000000000060'
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', day_id, 'amount_litres', 10
    ))
  );
  PERFORM pg_sleep(0.002);
  transfer_at := clock_timestamp();
  transfer := public.record_fuel_transfer(
    jsonb_build_object(
      'vessel_id', vessel_id,
      'source_tank_id', main_id, 'destination_tank_id', day_id,
      'amount_litres', 5, 'effective_at', transfer_at,
      'utc_offset_minutes', 0,
      'transfer_date', (transfer_at AT TIME ZONE 'UTC')::DATE,
      'transfer_time', (transfer_at AT TIME ZONE 'UTC')::TIME,
      'location', 'Engine room', 'notes', 'Retained archived-tank transfer'
    ),
    'a4000000-0000-0000-0000-000000000061'
  );
  INSERT INTO archived_source_fixture VALUES (
    (receipt ->> 'id')::UUID, receipt_at,
    (transfer ->> 'id')::UUID, transfer_at
  );
END;
$$;

-- Make Day Tank zero, archive it, and prove a later correction cannot leave a
-- hidden balance or restore its historical ID.
SELECT public.record_fuel_inventory_entry(
  'a1000000-0000-0000-0000-000000000001', 'CONSUMPTION',
  clock_timestamp(), 0::SMALLINT,
  (SELECT id FROM public.fuel_tanks WHERE name = 'Day Tank'),
  115, NULL, NULL, 'Drain day tank before archive',
  'a4000000-0000-0000-0000-000000000050'
);
SELECT pg_sleep(0.02);
SELECT public.save_vessel_fuel_setup(
  'a1000000-0000-0000-0000-000000000001', 'LITRES',
  jsonb_build_array(
    jsonb_build_object('id', (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
      'name', 'Main Tank', 'location', 'Engine room', 'capacity_litres', 1000),
    jsonb_build_object('id', (SELECT id FROM public.fuel_tanks WHERE name = 'Reserve Tank'),
      'name', 'Reserve Tank', 'location', 'Tank deck', 'capacity_litres', 300)
  ),
  2,
  'a5000000-0000-0000-0000-000000000013'
);

DO $$
DECLARE
  fixture archived_source_fixture%ROWTYPE;
  main_id UUID := (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank');
  day_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE name = 'Day Tank' AND archived_at IS NOT NULL);
  updated_receipt JSONB;
  updated_transfer JSONB;
BEGIN
  SELECT * INTO fixture FROM archived_source_fixture;
  updated_receipt := public.update_fuel_log_with_tank_entries(
    fixture.fuel_log_id,
    'a1000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'expected_revision', 1,
      'client_request_id', 'a4000000-0000-0000-0000-000000000062',
      'amendment_reason', 'Clarify retained receipt after tank archival',
      'effective_at', fixture.fuel_log_effective_at,
      'utc_offset_minutes', 0,
      'amount_of_fuel', 10, 'total_price', 10,
      'comment', 'Corrected retained archived-tank receipt'
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', day_id, 'amount_litres', 10
    ))
  );
  IF (updated_receipt ->> 'inventory_revision')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'Retained archived-tank receipt could not be amended';
  END IF;

  updated_transfer := public.amend_fuel_transfer(
    fixture.fuel_transfer_id, 1,
    jsonb_build_object(
      'source_tank_id', main_id, 'destination_tank_id', day_id,
      'amount_litres', 5,
      'effective_at', fixture.fuel_transfer_effective_at,
      'utc_offset_minutes', 0,
      'transfer_date', (fixture.fuel_transfer_effective_at AT TIME ZONE 'UTC')::DATE,
      'transfer_time', (fixture.fuel_transfer_effective_at AT TIME ZONE 'UTC')::TIME,
      'location', 'Engine room', 'notes', 'Corrected retained transfer note'
    ),
    'Clarify retained transfer after tank archival',
    'a4000000-0000-0000-0000-000000000063'
  );
  IF (updated_transfer ->> 'inventory_revision')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'Retained archived-tank transfer could not be amended';
  END IF;
END;
$$;

DO $$
DECLARE
  archived_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE name = 'Day Tank' AND archived_at IS NOT NULL);
  consumption_id UUID := (SELECT id FROM public.fuel_inventory_operations
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000050');
  rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.amend_fuel_inventory_entry(
      consumption_id, 1,
      (SELECT effective_at FROM public.fuel_inventory_operations WHERE id = consumption_id),
      0::SMALLINT, 90, NULL, NULL, 'Incorrect hidden balance', 'Must preserve zero archive',
      'a4000000-0000-0000-0000-000000000051'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%archived fuel tank must keep a zero current balance%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Correction left fuel hidden in an archived tank'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.save_vessel_fuel_setup(
      'a1000000-0000-0000-0000-000000000001', 'LITRES',
      jsonb_build_array(
        jsonb_build_object('id', (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
          'name', 'Main Tank', 'capacity_litres', 1000),
        jsonb_build_object('id', (SELECT id FROM public.fuel_tanks WHERE name = 'Reserve Tank'),
          'name', 'Reserve Tank', 'capacity_litres', 300),
        jsonb_build_object('id', archived_id, 'name', 'Day Tank', 'capacity_litres', 500)
      ),
      3,
      'a5000000-0000-0000-0000-000000000014'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Archived fuel tank IDs cannot be restored%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Archived tank ID was restored'; END IF;
END;
$$;

-- Archived allocations and inconsistent source timestamps are rejected before
-- any legacy source row can escape the atomic wrapper.
DO $$
DECLARE
  archived_id UUID := (SELECT id FROM public.fuel_tanks
    WHERE name = 'Day Tank' AND archived_at IS NOT NULL);
  effective_at TIMESTAMPTZ := clock_timestamp();
  rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.create_fuel_log_with_tank_entries(
      jsonb_build_object(
        'vessel_id', 'a1000000-0000-0000-0000-000000000001',
        'log_date', (effective_at AT TIME ZONE 'UTC')::DATE,
        'log_time', (effective_at AT TIME ZONE 'UTC')::TIME,
        'amount_of_fuel', 5, 'price_per_gallon', 1, 'total_price', 5,
        'volume_unit', 'LITRES', 'currency_code', 'USD',
        'effective_at', effective_at, 'utc_offset_minutes', 0,
        'client_request_id', 'a4000000-0000-0000-0000-000000000071'
      ),
      jsonb_build_array(jsonb_build_object(
        'fuel_tank_id', archived_id, 'amount_litres', 5
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%tanks active on the vessel%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Receipt was allocated to an archived tank'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.create_fuel_log_with_tank_entries(
      jsonb_build_object(
        'vessel_id', 'a1000000-0000-0000-0000-000000000001',
        'log_date', (effective_at AT TIME ZONE 'UTC')::DATE,
        'log_time', ((effective_at + interval '1 hour') AT TIME ZONE 'UTC')::TIME,
        'amount_of_fuel', 5, 'price_per_gallon', 1, 'total_price', 5,
        'volume_unit', 'LITRES', 'currency_code', 'USD',
        'effective_at', effective_at, 'utc_offset_minutes', 0,
        'client_request_id', 'a4000000-0000-0000-0000-000000000072'
      ),
      jsonb_build_array(jsonb_build_object(
        'fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
        'amount_litres', 5
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%does not match effective time%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Mismatched receipt local time was accepted'; END IF;
END;
$$;

-- Allocation reads preserve the tank name captured by the ledger revision,
-- even after a catalogue rename, and continue to report an archived tank.
CREATE TEMP TABLE allocation_snapshot_fixture (
  renamed_log_id UUID NOT NULL
) ON COMMIT DROP;
DO $$
DECLARE
  effective_at TIMESTAMPTZ := clock_timestamp();
  receipt JSONB;
BEGIN
  receipt := public.create_fuel_log_with_tank_entries(
    jsonb_build_object(
      'vessel_id', 'a1000000-0000-0000-0000-000000000001',
      'location_of_refueling', 'Rename regression quay',
      'log_date', (effective_at AT TIME ZONE 'UTC')::DATE,
      'log_time', (effective_at AT TIME ZONE 'UTC')::TIME,
      'amount_of_fuel', 5, 'price_per_gallon', 1, 'total_price', 5,
      'volume_unit', 'LITRES', 'currency_code', 'USD',
      'effective_at', effective_at, 'utc_offset_minutes', 0,
      'client_request_id', 'a4000000-0000-0000-0000-000000000073'
    ),
    jsonb_build_array(jsonb_build_object(
      'fuel_tank_id', (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
      'amount_litres', 5
    ))
  );
  INSERT INTO allocation_snapshot_fixture VALUES ((receipt ->> 'id')::UUID);
END;
$$;

SELECT public.save_vessel_fuel_setup(
  'a1000000-0000-0000-0000-000000000001', 'LITRES',
  jsonb_build_array(
    jsonb_build_object('id', (SELECT id FROM public.fuel_tanks WHERE name = 'Main Tank'),
      'name', 'Main Tank Renamed', 'location', 'Engine room', 'capacity_litres', 1000),
    jsonb_build_object('id', (SELECT id FROM public.fuel_tanks WHERE name = 'Reserve Tank'),
      'name', 'Reserve Tank', 'location', 'Tank deck', 'capacity_litres', 300)
  ),
  3,
  'a5000000-0000-0000-0000-000000000015'
);

DO $$
DECLARE
  renamed_log_id UUID := (SELECT fixture.renamed_log_id FROM allocation_snapshot_fixture AS fixture);
  archived_log_id UUID := (SELECT fixture.fuel_log_id FROM archived_source_fixture AS fixture);
  archived_transfer_id UUID := (SELECT fixture.fuel_transfer_id FROM archived_source_fixture AS fixture);
  snapshot JSONB;
  transfers JSONB;
BEGIN
  snapshot := public.get_fuel_log_allocation_snapshot(
    'a1000000-0000-0000-0000-000000000001',
    ARRAY[renamed_log_id, renamed_log_id, archived_log_id]
  );
  IF jsonb_array_length(snapshot -> 'allocations') <> 2
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(snapshot -> 'allocations') AS allocation
      WHERE allocation ->> 'fuel_log_id' = renamed_log_id::TEXT
        AND allocation ->> 'tank_name' = 'Main Tank'
        AND allocation ->> 'source' = 'LEDGER'
    ) OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(snapshot -> 'allocations') AS allocation
      WHERE allocation ->> 'fuel_log_id' = archived_log_id::TEXT
        AND allocation ->> 'tank_name' = 'Day Tank'
        AND allocation ->> 'source' = 'LEDGER'
    ) THEN
    RAISE EXCEPTION 'Canonical allocation snapshot changed historical names: %', snapshot;
  END IF;

  transfers := public.get_fuel_transfers_with_snapshots(
    'a1000000-0000-0000-0000-000000000001'
  );
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(transfers -> 'transfers') AS transfer
    WHERE transfer ->> 'id' = archived_transfer_id::TEXT
      AND transfer ->> 'source_tank_name' = 'Main Tank'
      AND transfer ->> 'destination_tank_name' = 'Day Tank'
      AND transfer ->> 'snapshot_source' = 'LEDGER'
  ) THEN
    RAISE EXCEPTION 'Transfer snapshot changed historical tank names: %', transfers;
  END IF;
END;
$$;

-- NULL never bypasses an optimistic expected-revision check.
DO $$
DECLARE
  opening_id UUID := (SELECT id FROM public.fuel_inventory_operations
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000003');
  transfer_id UUID := (SELECT fuel_transfer_id FROM archived_source_fixture);
  fuel_log_id UUID := (SELECT fuel_log_id FROM archived_source_fixture);
  entry_id UUID := (SELECT id FROM public.fuel_inventory_operations
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000037');
  transfer_row public.fuel_transfers%ROWTYPE;
  transfer_operation public.fuel_inventory_operations%ROWTYPE;
  rejected BOOLEAN;
BEGIN
  rejected := FALSE;
  BEGIN
    PERFORM public.amend_fuel_inventory_opening(
      opening_id, NULL,
      (SELECT effective_at FROM public.fuel_inventory_operations WHERE id = opening_id),
      0::SMALLINT,
      (SELECT jsonb_agg(jsonb_build_object(
        'fuel_tank_id', posting.fuel_tank_id,
        'amount_litres', posting.amount_litres
      ) ORDER BY posting.fuel_tank_id)
      FROM public.fuel_inventory_postings AS posting
      WHERE posting.operation_id = opening_id),
      'Null revision probe', 'Null revision probe',
      'a4000000-0000-0000-0000-000000000080'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%changed since%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'NULL opening revision was accepted'; END IF;

  SELECT * INTO transfer_row FROM public.fuel_transfers WHERE id = transfer_id;
  SELECT * INTO transfer_operation FROM public.fuel_inventory_operations
  WHERE id = transfer_row.current_inventory_operation_id;
  rejected := FALSE;
  BEGIN
    PERFORM public.amend_fuel_transfer(
      transfer_id, NULL,
      jsonb_build_object(
        'source_tank_id', transfer_row.source_tank_id,
        'destination_tank_id', transfer_row.destination_tank_id,
        'amount_litres', transfer_row.amount_litres,
        'effective_at', transfer_operation.effective_at,
        'utc_offset_minutes', transfer_operation.utc_offset_minutes,
        'transfer_date', transfer_row.transfer_date,
        'transfer_time', transfer_row.transfer_time,
        'location', transfer_row.location, 'notes', transfer_row.notes
      ),
      'Null revision probe',
      'a4000000-0000-0000-0000-000000000081'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%changed since%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'NULL transfer amendment revision was accepted'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.void_fuel_transfer(
      transfer_id, NULL, 'Null revision probe',
      'a4000000-0000-0000-0000-000000000082'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%changed since%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'NULL transfer void revision was accepted'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.void_fuel_log(
      fuel_log_id, NULL, 'Null revision probe',
      'a4000000-0000-0000-0000-000000000083'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%changed since%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'NULL fuel-log void revision was accepted'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.amend_fuel_inventory_entry(
      entry_id, NULL,
      (SELECT effective_at FROM public.fuel_inventory_operations WHERE id = entry_id),
      0::SMALLINT,
      (SELECT amount_litres FROM public.fuel_inventory_postings
        WHERE operation_id = entry_id),
      'Engine room', NULL, 'Null revision probe', 'Null revision probe',
      'a4000000-0000-0000-0000-000000000084'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%changed since%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'NULL entry amendment revision was accepted'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.void_fuel_inventory_entry(
      entry_id, NULL, 'Null revision probe',
      'a4000000-0000-0000-0000-000000000085'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%changed since%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'NULL entry void revision was accepted'; END IF;
END;
$$;

-- History carries complete void attribution and sorts a newly recorded void as
-- current audit activity, even when its original operation is old.
DO $$
DECLARE
  history JSONB := public.get_fuel_inventory_history(
    'a1000000-0000-0000-0000-000000000001', NULL, 100, NULL
  );
  operation_id UUID := (SELECT id FROM public.fuel_inventory_operations
    WHERE client_request_id = 'a4000000-0000-0000-0000-000000000030');
  operation_json JSONB;
BEGIN
  operation_json := public.get_fuel_inventory_operation(operation_id);
  IF operation_json ->> 'id' IS DISTINCT FROM operation_id::TEXT
    OR NOT (operation_json ?& ARRAY['vessel_id', 'metadata', 'postings', 'voided']) THEN
    RAISE EXCEPTION 'Single-operation reader returned an incomplete record: %', operation_json;
  END IF;
  IF jsonb_array_length(history -> 'operations') < 1 THEN
    RAISE EXCEPTION 'Fuel inventory history is empty';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(history -> 'operations') AS operation
    WHERE (operation ->> 'voided')::BOOLEAN
      AND operation ?& ARRAY[
        'vessel_id', 'utc_offset_minutes', 'audit_sequence',
        'void_kind', 'void_reason', 'void_created_by',
        'void_created_by_name', 'void_recorded_at', 'postings'
      ]
  ) THEN
    RAISE EXCEPTION 'History omitted void audit attribution: %', history;
  END IF;
END;
$$;

-- Another vessel cannot observe snapshots or ledger rows through SECURITY
-- DEFINER readers or RLS.
CREATE TEMP TABLE fuel_inventory_cross_vessel_operation AS
SELECT id AS operation_id
FROM public.fuel_inventory_operations
WHERE client_request_id = 'a4000000-0000-0000-0000-000000000030';
SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000004', false);
DO $$
DECLARE
  rejected BOOLEAN := FALSE;
  operation_id UUID := (SELECT cross_vessel.operation_id
    FROM fuel_inventory_cross_vessel_operation AS cross_vessel);
BEGIN
  BEGIN
    PERFORM public.get_fuel_inventory_snapshot(
      'a1000000-0000-0000-0000-000000000001', clock_timestamp()
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Only active vessel members%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cross-vessel inventory snapshot was exposed'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.get_fuel_inventory_operation(operation_id);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Only active vessel members%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cross-vessel inventory operation was exposed'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.get_vessel_fuel_setup(
      'a1000000-0000-0000-0000-000000000001'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%do not have access%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cross-vessel fuel setup was exposed'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.get_fuel_log_allocation_snapshot(
      'a1000000-0000-0000-0000-000000000001', ARRAY[]::UUID[]
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%do not have access%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cross-vessel fuel allocations were exposed'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.get_fuel_transfers_with_snapshots(
      'a1000000-0000-0000-0000-000000000001'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%do not have access%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cross-vessel fuel transfers were exposed'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.get_fuel_inventory_legacy_audits(
      'a1000000-0000-0000-0000-000000000001', NULL, NULL, 50, NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%do not have access%' THEN RAISE; END IF;
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cross-vessel legacy fuel audits were exposed'; END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public._fuel_inventory_operation_json(operation_id);
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Private operation helper remained callable'; END IF;

  IF EXISTS (SELECT 1 FROM public.fuel_inventory_operations
    WHERE vessel_id = 'a1000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Cross-vessel ledger rows were exposed by RLS';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000001', false);
SET CONSTRAINTS ALL IMMEDIATE;

RESET ROLE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.fuel_logs AS fuel_log
    JOIN public.fuel_inventory_operations AS operation
      ON operation.id = fuel_log.current_inventory_operation_id
    WHERE fuel_log.effective_at IS DISTINCT FROM operation.effective_at
      OR fuel_log.utc_offset_minutes IS DISTINCT FROM operation.utc_offset_minutes
  ) THEN
    RAISE EXCEPTION 'A posted fuel receipt source lost its current ship-time evidence';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.fuel_transfers AS transfer
    JOIN public.fuel_inventory_operations AS operation
      ON operation.id = transfer.current_inventory_operation_id
    WHERE transfer.effective_at IS DISTINCT FROM operation.effective_at
      OR transfer.utc_offset_minutes IS DISTINCT FROM operation.utc_offset_minutes
  ) THEN
    RAISE EXCEPTION 'A posted fuel transfer source lost its current ship-time evidence';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'fuel inventory ledger tests passed' AS result;
