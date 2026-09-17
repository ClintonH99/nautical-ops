-- Restore production objects that were implemented in historical migrations
-- but never recorded in the linked database's migration history. Keep this as
-- a forward-only migration: replaying the old gaps with --include-all could
-- also replay the production baseline and is not safe.

BEGIN;

-- Per-installation notification tokens are required by the deployed
-- send-trip-push function. Existing device rows begin with NULL tokens and are
-- populated normally when each installation next registers for notifications.
ALTER TABLE public.user_devices
  ADD COLUMN IF NOT EXISTS expo_push_token TEXT,
  ADD COLUMN IF NOT EXISTS push_token_updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_expo_push_token
  ON public.user_devices (expo_push_token)
  WHERE expo_push_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_current_device_push_token(
  p_device_fingerprint TEXT,
  p_expo_push_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token TEXT := trim(p_expo_push_token);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_device_fingerprint IS NULL OR length(trim(p_device_fingerprint)) < 16 THEN
    RAISE EXCEPTION 'Invalid device fingerprint';
  END IF;

  IF v_token IS NULL
    OR length(v_token) > 512
    OR (
      v_token NOT LIKE 'ExponentPushToken[%]'
      AND v_token NOT LIKE 'ExpoPushToken[%]'
    )
  THEN
    RAISE EXCEPTION 'Invalid Expo push token';
  END IF;

  UPDATE public.user_devices
  SET expo_push_token = v_token,
      push_token_updated_at = now(),
      last_seen_at = now()
  WHERE user_id = auth.uid()
    AND device_fingerprint = p_device_fingerprint
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current device is not registered';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.set_current_device_push_token(TEXT, TEXT)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_current_device_push_token(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_current_device_push_token(
  p_device_fingerprint TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.user_devices
  SET expo_push_token = NULL,
      push_token_updated_at = now(),
      last_seen_at = now()
  WHERE user_id = auth.uid()
    AND device_fingerprint = p_device_fingerprint
    AND revoked_at IS NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_current_device_push_token(TEXT)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.clear_current_device_push_token(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_current_device()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id TEXT :=
    current_setting('request.jwt.claims', true)::jsonb ->> 'session_id';
BEGIN
  IF auth.uid() IS NULL OR v_session_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.user_devices
  SET revoked_at = now(),
      session_id = NULL,
      expo_push_token = NULL,
      push_token_updated_at = now(),
      last_seen_at = now()
  WHERE user_id = auth.uid()
    AND revoked_at IS NULL
    AND session_id::TEXT = v_session_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_current_device()
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_current_device() TO authenticated;

COMMENT ON COLUMN public.user_devices.expo_push_token IS
  'Expo push token for this registered installation. Cleared when the device is revoked.';

-- Service-role-only vessel transitions used by the hardened Edge Functions.
CREATE OR REPLACE FUNCTION public.admin_leave_current_vessel(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_profile public.users%ROWTYPE;
  current_vessel public.vessels%ROWTYPE;
  created_vessel public.vessels%ROWTYPE;
  other_captains INTEGER;
BEGIN
  SELECT * INTO current_profile
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR current_profile.vessel_id IS NULL THEN
    RAISE EXCEPTION 'You are not currently part of a vessel';
  END IF;

  SELECT * INTO current_vessel
  FROM public.vessels
  WHERE id = current_profile.vessel_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current vessel not found'; END IF;
  IF current_vessel.is_solo THEN
    RAISE EXCEPTION 'You already have your own private account - there is nothing to leave.';
  END IF;

  IF current_profile.role = 'CAPTAIN_MOV' THEN
    SELECT count(*) INTO other_captains
    FROM public.users
    WHERE vessel_id = current_profile.vessel_id
      AND role = 'CAPTAIN_MOV'
      AND id <> p_user_id;
    IF other_captains < 1 THEN
      RAISE EXCEPTION 'You are the only Captain/MOV on this vessel. Promote another crew member to Captain/MOV in Crew Management before leaving.';
    END IF;
  END IF;

  INSERT INTO public.vessels (name, invite_code, invite_expiry, is_solo)
  VALUES ('Crew Account', public.generate_vessel_invite_code(), now() + INTERVAL '1 year', TRUE)
  RETURNING * INTO created_vessel;

  PERFORM set_config('nautical_ops.trusted_user_change', 'on', true);
  UPDATE public.users
  SET vessel_id = created_vessel.id,
      role = 'CREW',
      rotation_group_id = NULL,
      paused = FALSE,
      vessel_joined_at = now(),
      updated_at = now()
  WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Could not move account to a private vessel'; END IF;
  PERFORM set_config('nautical_ops.trusted_user_change', 'off', true);

  RETURN jsonb_build_object('success', true, 'vessel_id', created_vessel.id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_leave_current_vessel(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_leave_current_vessel(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_delete_current_vessel(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_profile public.users%ROWTYPE;
  subscription_row public.vessel_subscriptions%ROWTYPE;
  crew_member public.users%ROWTYPE;
  created_vessel public.vessels%ROWTYPE;
  deleted_vessel_id UUID;
  moved_user_count INTEGER := 0;
  cancellation_provider TEXT := NULL;
BEGIN
  SELECT * INTO current_profile
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR current_profile.vessel_id IS NULL OR current_profile.role <> 'CAPTAIN_MOV' THEN
    RAISE EXCEPTION 'Only the Captain/MOV can delete a vessel';
  END IF;
  deleted_vessel_id := current_profile.vessel_id;

  PERFORM 1 FROM public.vessels WHERE id = deleted_vessel_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vessel not found'; END IF;

  SELECT * INTO subscription_row
  FROM public.vessel_subscriptions
  WHERE vessel_id = deleted_vessel_id
  ORDER BY current_period_end DESC
  LIMIT 1;

  IF FOUND AND subscription_row.paddle_subscription_id IS NOT NULL THEN
    RAISE EXCEPTION 'This vessel has a legacy billing record. Contact support@nautical-ops.com so billing can be cancelled safely before the vessel is deleted.';
  END IF;
  IF FOUND AND subscription_row.payment_provider IN ('apple', 'google') THEN
    cancellation_provider := subscription_row.payment_provider;
  END IF;

  PERFORM 1 FROM public.users WHERE vessel_id = deleted_vessel_id FOR UPDATE;
  PERFORM set_config('nautical_ops.trusted_user_change', 'on', true);
  FOR crew_member IN
    SELECT * FROM public.users WHERE vessel_id = deleted_vessel_id ORDER BY id
  LOOP
    INSERT INTO public.vessels (name, invite_code, invite_expiry, is_solo)
    VALUES ('Crew Account', public.generate_vessel_invite_code(), now() + INTERVAL '1 year', TRUE)
    RETURNING * INTO created_vessel;

    UPDATE public.users
    SET vessel_id = created_vessel.id,
        role = 'CREW',
        rotation_group_id = NULL,
        paused = FALSE,
        vessel_joined_at = now(),
        updated_at = now()
    WHERE id = crew_member.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Could not move every account to a private vessel'; END IF;
    moved_user_count := moved_user_count + 1;
  END LOOP;
  PERFORM set_config('nautical_ops.trusted_user_change', 'off', true);

  DELETE FROM public.vessels WHERE id = deleted_vessel_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Could not delete vessel'; END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_vessel_id', deleted_vessel_id,
    'moved_user_count', moved_user_count,
    'cancellation_provider', cancellation_provider
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_current_vessel(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_current_vessel(UUID) TO service_role;

-- One-time QR link claim and consumption. Both changes are atomic so a code
-- cannot be claimed or consumed twice by racing requests.
CREATE OR REPLACE FUNCTION public.admin_claim_auth_link(
  p_code TEXT,
  p_action_link TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claimed_code TEXT;
BEGIN
  UPDATE public.auth_links
  SET action_link = p_action_link
  WHERE code = p_code
    AND action_link IS NULL
    AND expires_at > now()
  RETURNING code INTO claimed_code;

  RETURN claimed_code IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_claim_auth_link(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_claim_auth_link(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_consume_auth_link(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  auth_link public.auth_links%ROWTYPE;
BEGIN
  SELECT * INTO auth_link
  FROM public.auth_links
  WHERE code = p_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'pending');
  END IF;

  IF auth_link.expires_at <= now() THEN
    DELETE FROM public.auth_links WHERE code = p_code;
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF auth_link.action_link IS NULL OR btrim(auth_link.action_link) = '' THEN
    RETURN jsonb_build_object('status', 'pending');
  END IF;

  DELETE FROM public.auth_links WHERE code = p_code;
  RETURN jsonb_build_object(
    'status', 'ready',
    'action_link', btrim(auth_link.action_link)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_consume_auth_link(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_consume_auth_link(TEXT) TO service_role;

-- Transactional account deletion preparation. The Auth user deletion remains
-- a separate Admin API call, and this database phase is safe to retry.
CREATE OR REPLACE FUNCTION public.admin_prepare_account_deletion(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_profile public.users%ROWTYPE;
  current_vessel public.vessels%ROWTYPE;
  subscription_row public.vessel_subscriptions%ROWTYPE;
  other_user_count INTEGER := 0;
  other_captain_count INTEGER := 0;
  cleanup_vessel BOOLEAN := FALSE;
  cleanup_vessel_id UUID := NULL;
  cancellation_provider TEXT := NULL;
BEGIN
  SELECT * INTO current_profile
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'profile_already_removed', true,
      'deleted_vessel_id', NULL,
      'cancellation_provider', NULL
    );
  END IF;

  IF current_profile.vessel_id IS NOT NULL THEN
    SELECT * INTO current_vessel
    FROM public.vessels
    WHERE id = current_profile.vessel_id
    FOR UPDATE;

    IF FOUND THEN
      PERFORM 1 FROM public.users
      WHERE vessel_id = current_profile.vessel_id
      FOR UPDATE;

      SELECT
        count(*) FILTER (WHERE id <> p_user_id),
        count(*) FILTER (WHERE id <> p_user_id AND role = 'CAPTAIN_MOV')
      INTO other_user_count, other_captain_count
      FROM public.users
      WHERE vessel_id = current_profile.vessel_id;

      IF current_profile.role = 'CAPTAIN_MOV'
         AND other_user_count > 0
         AND other_captain_count = 0 THEN
        RAISE EXCEPTION 'You are the only Captain/MOV on this vessel. Promote another crew member to Captain/MOV in Crew Management before deleting your account.';
      END IF;

      cleanup_vessel := other_user_count = 0;
      IF cleanup_vessel THEN
        cleanup_vessel_id := current_profile.vessel_id;

        SELECT * INTO subscription_row
        FROM public.vessel_subscriptions
        WHERE vessel_id = cleanup_vessel_id
        ORDER BY current_period_end DESC
        LIMIT 1;

        IF FOUND AND subscription_row.paddle_subscription_id IS NOT NULL THEN
          RAISE EXCEPTION 'This account has a legacy billing record. Contact support@nautical-ops.com so billing can be cancelled safely before deleting the account.';
        END IF;
        IF FOUND AND subscription_row.payment_provider IN ('apple', 'google') THEN
          cancellation_provider := subscription_row.payment_provider;
        END IF;
      END IF;
    END IF;
  END IF;

  DELETE FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Could not remove account profile'; END IF;

  IF cleanup_vessel AND cleanup_vessel_id IS NOT NULL THEN
    DELETE FROM public.vessels WHERE id = cleanup_vessel_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Could not remove private vessel'; END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'profile_already_removed', false,
    'deleted_vessel_id', cleanup_vessel_id,
    'cancellation_provider', cancellation_provider
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_prepare_account_deletion(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_prepare_account_deletion(UUID) TO service_role;

-- Bind a verified Apple transaction to its vessel and consume the short-lived
-- purchase token in the same transaction.
CREATE OR REPLACE FUNCTION public.admin_record_apple_subscription(
  p_vessel_id UUID,
  p_plan_tier TEXT,
  p_billing_period TEXT,
  p_status TEXT,
  p_original_transaction_id TEXT,
  p_latest_transaction_id TEXT,
  p_current_period_start TIMESTAMPTZ,
  p_current_period_end TIMESTAMPTZ,
  p_grace_period_end TIMESTAMPTZ,
  p_billing_retry_started_at TIMESTAMPTZ,
  p_verified_at TIMESTAMPTZ,
  p_pending_purchase_id UUID DEFAULT NULL,
  p_pending_user_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  consumed_purchase_id UUID;
  linked_vessel_id UUID;
BEGIN
  IF p_status NOT IN ('active', 'past_due', 'canceled', 'revoked') THEN
    RAISE EXCEPTION 'Unsupported subscription status';
  END IF;

  SELECT vessel_id INTO linked_vessel_id
  FROM public.vessel_subscriptions
  WHERE apple_original_transaction_id = p_original_transaction_id
  FOR UPDATE;
  IF FOUND AND linked_vessel_id <> p_vessel_id THEN
    RAISE EXCEPTION 'This Apple subscription is already linked to another vessel';
  END IF;

  IF p_pending_purchase_id IS NOT NULL THEN
    UPDATE public.pending_subscription_purchases
    SET consumed_at = now()
    WHERE id = p_pending_purchase_id
      AND provider = 'apple'
      AND vessel_id = p_vessel_id
      AND (p_pending_user_id IS NULL OR user_id = p_pending_user_id)
      AND consumed_at IS NULL
      AND expires_at > now()
    RETURNING id INTO consumed_purchase_id;

    IF consumed_purchase_id IS NULL THEN
      RAISE EXCEPTION 'Purchase account link is invalid, expired, or already used';
    END IF;
  END IF;

  INSERT INTO public.vessel_subscriptions (
    vessel_id,
    plan_tier,
    billing_period,
    status,
    payment_provider,
    apple_original_transaction_id,
    apple_latest_transaction_id,
    current_period_start,
    current_period_end,
    grace_period_end,
    billing_retry_started_at,
    last_verified_at,
    updated_at
  )
  VALUES (
    p_vessel_id,
    p_plan_tier,
    p_billing_period,
    p_status,
    'apple',
    p_original_transaction_id,
    p_latest_transaction_id,
    p_current_period_start,
    p_current_period_end,
    p_grace_period_end,
    p_billing_retry_started_at,
    p_verified_at,
    now()
  )
  ON CONFLICT (vessel_id) DO UPDATE SET
    plan_tier = EXCLUDED.plan_tier,
    billing_period = EXCLUDED.billing_period,
    status = EXCLUDED.status,
    payment_provider = 'apple',
    apple_original_transaction_id = EXCLUDED.apple_original_transaction_id,
    apple_latest_transaction_id = EXCLUDED.apple_latest_transaction_id,
    current_period_start = EXCLUDED.current_period_start,
    current_period_end = EXCLUDED.current_period_end,
    grace_period_end = EXCLUDED.grace_period_end,
    billing_retry_started_at = EXCLUDED.billing_retry_started_at,
    last_verified_at = EXCLUDED.last_verified_at,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_apple_subscription(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_apple_subscription(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID
) TO service_role;

-- These existing mobile RPCs authenticate internally and are only app-facing.
-- Remove unnecessary direct execution from anonymous and service roles while
-- retaining the authenticated-client path.
REVOKE ALL ON FUNCTION public.join_current_user_to_vessel(TEXT)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.join_current_user_to_vessel(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_current_vessel_crew_rotation(UUID)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.assign_current_vessel_crew_rotation(UUID) TO authenticated;

COMMIT;
