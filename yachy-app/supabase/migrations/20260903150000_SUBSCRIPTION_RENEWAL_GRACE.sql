-- Track the payment provider and renewal-recovery window for both existing and
-- future vessel subscriptions. Access is only restricted after this grace
-- period has ended; a network failure is handled by the client as unknown and
-- never as non-payment.

ALTER TABLE public.vessel_subscriptions
  ADD COLUMN IF NOT EXISTS payment_provider TEXT,
  ADD COLUMN IF NOT EXISTS grace_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_retry_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS apple_original_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS apple_latest_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS google_purchase_token TEXT,
  ADD COLUMN IF NOT EXISTS google_order_id TEXT,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

UPDATE public.vessel_subscriptions
SET payment_provider = CASE
  WHEN paddle_subscription_id IS NOT NULL THEN 'paddle'
  ELSE 'apple'
END
WHERE payment_provider IS NULL;

ALTER TABLE public.vessel_subscriptions
  DROP CONSTRAINT IF EXISTS vessel_subscriptions_payment_provider_check;

ALTER TABLE public.vessel_subscriptions
  DROP CONSTRAINT IF EXISTS vessel_subscriptions_status_check;

ALTER TABLE public.vessel_subscriptions
  ADD CONSTRAINT vessel_subscriptions_status_check
  CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'revoked'));

ALTER TABLE public.vessel_subscriptions
  ADD CONSTRAINT vessel_subscriptions_payment_provider_check
  CHECK (payment_provider IS NULL OR payment_provider IN ('apple', 'google', 'paddle'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_vessel_subscriptions_apple_original_transaction
  ON public.vessel_subscriptions (apple_original_transaction_id)
  WHERE apple_original_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vessel_subscriptions_google_purchase_token
  ON public.vessel_subscriptions (google_purchase_token)
  WHERE google_purchase_token IS NOT NULL;

COMMENT ON COLUMN public.vessel_subscriptions.grace_period_end IS
  'Authoritative provider grace expiry. Legacy failed renewals fall back to current_period_end + 16 days in application access checks.';

COMMENT ON COLUMN public.vessel_subscriptions.apple_original_transaction_id IS
  'Stable Apple subscription-chain identifier; unique to prevent one purchase being attached to multiple vessels.';

COMMENT ON COLUMN public.vessel_subscriptions.google_purchase_token IS
  'Google Play purchase token; unique to prevent one purchase being attached to multiple vessels.';

COMMENT ON COLUMN public.vessel_subscriptions.payment_provider IS
  'Active Nautical Ops providers are apple and google. Paddle is retained only for historical row compatibility and must not be used for new Nautical Ops purchases.';
