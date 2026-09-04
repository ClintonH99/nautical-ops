\set ON_ERROR_STOP on

DO $$
DECLARE
  old_vessel UUID := '10000000-0000-0000-0000-000000000001';
  captain UUID := '20000000-0000-0000-0000-000000000001';
  crew UUID := '20000000-0000-0000-0000-000000000002';
  new_vessel UUID;
BEGIN
  INSERT INTO vessels (id, name, invite_code, is_solo)
  VALUES (old_vessel, 'Leave Test', 'LEAVETEST001', FALSE);
  INSERT INTO users (id, vessel_id, role) VALUES
    (captain, old_vessel, 'CAPTAIN_MOV'),
    (crew, old_vessel, 'CREW');

  PERFORM admin_leave_current_vessel(crew);
  SELECT vessel_id INTO new_vessel FROM users WHERE id = crew;

  IF new_vessel = old_vessel OR new_vessel IS NULL THEN
    RAISE EXCEPTION 'Crew account was not moved atomically';
  END IF;
  IF (SELECT role FROM users WHERE id = crew) <> 'CREW' THEN
    RAISE EXCEPTION 'Moved account did not become CREW';
  END IF;
  IF NOT (SELECT is_solo FROM vessels WHERE id = new_vessel) THEN
    RAISE EXCEPTION 'Moved account did not receive a solo vessel';
  END IF;

  BEGIN
    PERFORM admin_leave_current_vessel(captain);
    RAISE EXCEPTION 'Sole Captain was incorrectly allowed to leave';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Sole Captain was incorrectly allowed to leave' THEN RAISE; END IF;
  END;
  IF (SELECT vessel_id FROM users WHERE id = captain) <> old_vessel THEN
    RAISE EXCEPTION 'Blocked Captain leave changed database state';
  END IF;
END;
$$;

DO $$
DECLARE
  vessel UUID := '10000000-0000-0000-0000-000000000006';
  purchaser UUID := '20000000-0000-0000-0000-000000000010';
  purchase_token UUID := '30000000-0000-0000-0000-000000000001';
  reuse_failed BOOLEAN := FALSE;
BEGIN
  INSERT INTO vessels (id, name, invite_code, is_solo)
  VALUES (vessel, 'Purchase Test', 'PURCHASETST1', FALSE);
  INSERT INTO users (id, vessel_id, role) VALUES (purchaser, vessel, 'CAPTAIN_MOV');
  INSERT INTO pending_subscription_purchases (id, user_id, vessel_id, provider)
  VALUES (purchase_token, purchaser, vessel, 'apple');

  PERFORM admin_record_apple_subscription(
    vessel, '1-5', 'monthly', 'active', 'original-1', 'latest-1',
    now(), now() + INTERVAL '1 month', NULL, NULL, now(), purchase_token, purchaser
  );
  IF NOT EXISTS (
    SELECT 1 FROM pending_subscription_purchases
    WHERE id = purchase_token AND consumed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Purchase token and subscription were not committed together';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vessel_subscriptions
    WHERE vessel_id = vessel AND apple_original_transaction_id = 'original-1'
  ) THEN
    RAISE EXCEPTION 'Verified Apple subscription was not recorded';
  END IF;

  BEGIN
    PERFORM admin_record_apple_subscription(
      vessel, '1-5', 'monthly', 'active', 'original-2', 'latest-2',
      now(), now() + INTERVAL '1 month', NULL, NULL, now(), purchase_token, purchaser
    );
  EXCEPTION
    WHEN OTHERS THEN reuse_failed := TRUE;
  END;
  IF NOT reuse_failed THEN RAISE EXCEPTION 'Consumed purchase token was reusable'; END IF;
  IF (SELECT apple_original_transaction_id FROM vessel_subscriptions WHERE vessel_id = vessel)
     <> 'original-1' THEN
    RAISE EXCEPTION 'Failed token reuse altered the active subscription';
  END IF;
END;
$$;

DO $$
DECLARE
  vessel_with_crew UUID := '10000000-0000-0000-0000-000000000004';
  deleting_captain UUID := '20000000-0000-0000-0000-000000000006';
  remaining_captain UUID := '20000000-0000-0000-0000-000000000007';
  crew UUID := '20000000-0000-0000-0000-000000000008';
  result JSONB;
BEGIN
  INSERT INTO vessels (id, name, invite_code, is_solo)
  VALUES (vessel_with_crew, 'Account Delete', 'ACCOUNTTEST1', FALSE);
  INSERT INTO users (id, vessel_id, role) VALUES
    (deleting_captain, vessel_with_crew, 'CAPTAIN_MOV'),
    (crew, vessel_with_crew, 'CREW');

  BEGIN
    PERFORM admin_prepare_account_deletion(deleting_captain);
    RAISE EXCEPTION 'Only Captain was allowed to abandon crew';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Only Captain was allowed to abandon crew' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = deleting_captain) THEN
    RAISE EXCEPTION 'Blocked account deletion changed database state';
  END IF;

  INSERT INTO users (id, vessel_id, role)
  VALUES (remaining_captain, vessel_with_crew, 'CAPTAIN_MOV');
  result := admin_prepare_account_deletion(deleting_captain);
  IF EXISTS (SELECT 1 FROM users WHERE id = deleting_captain) THEN
    RAISE EXCEPTION 'Captain profile was not deleted after succession';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vessels WHERE id = vessel_with_crew) OR
     NOT EXISTS (SELECT 1 FROM users WHERE id IN (remaining_captain, crew)) THEN
    RAISE EXCEPTION 'Shared vessel or remaining members were deleted';
  END IF;

  result := admin_prepare_account_deletion(deleting_captain);
  IF NOT (result->>'profile_already_removed')::BOOLEAN THEN
    RAISE EXCEPTION 'Account deletion database phase is not retry-safe';
  END IF;
END;
$$;

DO $$
DECLARE
  solo_vessel UUID := '10000000-0000-0000-0000-000000000005';
  captain UUID := '20000000-0000-0000-0000-000000000009';
  result JSONB;
BEGIN
  INSERT INTO vessels (id, name, invite_code, is_solo)
  VALUES (solo_vessel, 'Paid Solo Delete', 'ACCOUNTTEST2', FALSE);
  INSERT INTO users (id, vessel_id, role) VALUES (captain, solo_vessel, 'CAPTAIN_MOV');
  INSERT INTO vessel_subscriptions (vessel_id, payment_provider, current_period_end)
  VALUES (solo_vessel, 'google', now() + INTERVAL '1 month');

  result := admin_prepare_account_deletion(captain);
  IF result->>'cancellation_provider' <> 'google' THEN
    RAISE EXCEPTION 'Account deletion lost store cancellation reminder';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE id = captain) OR
     EXISTS (SELECT 1 FROM vessels WHERE id = solo_vessel) THEN
    RAISE EXCEPTION 'Empty account vessel was not removed atomically';
  END IF;
END;
$$;

DO $$
DECLARE
  old_vessel UUID := '10000000-0000-0000-0000-000000000002';
  captain UUID := '20000000-0000-0000-0000-000000000003';
  crew UUID := '20000000-0000-0000-0000-000000000004';
  result JSONB;
BEGIN
  INSERT INTO vessels (id, name, invite_code, is_solo)
  VALUES (old_vessel, 'Delete Test', 'DELETETEST01', FALSE);
  INSERT INTO users (id, vessel_id, role) VALUES
    (captain, old_vessel, 'CAPTAIN_MOV'),
    (crew, old_vessel, 'HOD');
  INSERT INTO vessel_subscriptions (vessel_id, payment_provider, current_period_end)
  VALUES (old_vessel, 'apple', now() + INTERVAL '1 month');

  result := admin_delete_current_vessel(captain);
  IF result->>'cancellation_provider' <> 'apple' THEN
    RAISE EXCEPTION 'Provider cancellation reminder was lost';
  END IF;
  IF (result->>'moved_user_count')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'Not every vessel member was moved';
  END IF;
  IF EXISTS (SELECT 1 FROM vessels WHERE id = old_vessel) THEN
    RAISE EXCEPTION 'Deleted vessel remains';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE id IN (captain, crew) AND role <> 'CREW') THEN
    RAISE EXCEPTION 'Moved vessel members retained privileged roles';
  END IF;
  IF (SELECT count(DISTINCT vessel_id) FROM users WHERE id IN (captain, crew)) <> 2 THEN
    RAISE EXCEPTION 'Moved members did not receive separate solo vessels';
  END IF;
END;
$$;

DO $$
DECLARE
  old_vessel UUID := '10000000-0000-0000-0000-000000000003';
  captain UUID := '20000000-0000-0000-0000-000000000005';
BEGIN
  INSERT INTO vessels (id, name, invite_code, is_solo)
  VALUES (old_vessel, 'Legacy Billing', 'PADDLETEST01', FALSE);
  INSERT INTO users (id, vessel_id, role) VALUES (captain, old_vessel, 'CAPTAIN_MOV');
  INSERT INTO vessel_subscriptions (vessel_id, paddle_subscription_id, payment_provider)
  VALUES (old_vessel, 'sub_legacy', 'paddle');

  BEGIN
    PERFORM admin_delete_current_vessel(captain);
    RAISE EXCEPTION 'Legacy-billed vessel was incorrectly deleted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Legacy-billed vessel was incorrectly deleted' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM vessels WHERE id = old_vessel) THEN
    RAISE EXCEPTION 'Blocked legacy deletion changed database state';
  END IF;
END;
$$;

DO $$
DECLARE
  claim_ok BOOLEAN;
  result JSONB;
BEGIN
  INSERT INTO auth_links (code, expires_at) VALUES
    ('ABCDEFGH2345', now() + INTERVAL '5 minutes'),
    ('ABCDEFGH2346', now() - INTERVAL '1 minute');

  claim_ok := admin_claim_auth_link('ABCDEFGH2345', 'https://example.test/one-time');
  IF NOT claim_ok THEN RAISE EXCEPTION 'Valid auth code could not be claimed'; END IF;
  IF admin_claim_auth_link('ABCDEFGH2345', 'https://example.test/replay') THEN
    RAISE EXCEPTION 'Auth code was claimed more than once';
  END IF;

  result := admin_consume_auth_link('ABCDEFGH2345');
  IF result->>'status' <> 'ready' OR result->>'action_link' <> 'https://example.test/one-time' THEN
    RAISE EXCEPTION 'Claimed auth link was not returned correctly';
  END IF;
  result := admin_consume_auth_link('ABCDEFGH2345');
  IF result->>'status' <> 'pending' THEN RAISE EXCEPTION 'Consumed link was reusable'; END IF;

  IF admin_claim_auth_link('ABCDEFGH2346', 'https://example.test/expired') THEN
    RAISE EXCEPTION 'Expired auth code was claimable';
  END IF;
  result := admin_consume_auth_link('ABCDEFGH2346');
  IF result->>'status' <> 'expired' THEN RAISE EXCEPTION 'Expired link was not rejected'; END IF;
END;
$$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'admin_leave_current_vessel(uuid)', 'EXECUTE') OR
     has_function_privilege('authenticated', 'admin_leave_current_vessel(uuid)', 'EXECUTE') OR
     has_function_privilege('anon', 'admin_consume_auth_link(text)', 'EXECUTE') OR
     has_function_privilege('authenticated', 'admin_claim_auth_link(text,text)', 'EXECUTE') OR
     has_function_privilege('authenticated', 'admin_prepare_account_deletion(uuid)', 'EXECUTE') OR
     has_function_privilege(
       'authenticated',
       'admin_record_apple_subscription(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'A privileged foundation RPC is exposed to app roles';
  END IF;
  IF NOT has_function_privilege('service_role', 'admin_delete_current_vessel(uuid)', 'EXECUTE') OR
     NOT has_function_privilege('service_role', 'admin_consume_auth_link(text)', 'EXECUTE') OR
     NOT has_function_privilege('service_role', 'admin_prepare_account_deletion(uuid)', 'EXECUTE') OR
     NOT has_function_privilege(
       'service_role',
       'admin_record_apple_subscription(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Service role cannot execute a required foundation RPC';
  END IF;
END;
$$;

SELECT 'foundation security tests passed' AS result;
