-- Timestamped migration: bind an Apple transaction and consume its short-lived purchase token in the
-- same transaction. This closes a race where simultaneous verifications could
-- both observe an unconsumed token before either request marked it consumed.

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
