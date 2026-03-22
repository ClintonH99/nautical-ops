-- Paddle Billing replaces Stripe for card checkout.
-- RevenueCat / Apple IAP unchanged.

ALTER TABLE public.vessel_subscriptions
  ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT;

ALTER TABLE public.vessel_subscriptions
  DROP COLUMN IF EXISTS stripe_subscription_id,
  DROP COLUMN IF EXISTS stripe_customer_id;

DROP INDEX IF EXISTS idx_vessel_subscriptions_stripe;

CREATE INDEX IF NOT EXISTS idx_vessel_subscriptions_paddle
  ON public.vessel_subscriptions (paddle_subscription_id)
  WHERE paddle_subscription_id IS NOT NULL;

COMMENT ON COLUMN public.vessel_subscriptions.paddle_subscription_id IS 'Paddle Billing subscription id (sub_*)';
COMMENT ON COLUMN public.vessel_subscriptions.paddle_customer_id IS 'Paddle Billing customer id (ctm_*)';
