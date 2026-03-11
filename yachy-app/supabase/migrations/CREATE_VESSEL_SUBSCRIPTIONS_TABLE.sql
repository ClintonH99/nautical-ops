-- Vessel Subscriptions
-- Captains (HODs) pay for vessel plans before accessing invite codes.
-- Supports Stripe (web) and RevenueCat (in-app) payment sources.

CREATE TABLE IF NOT EXISTS public.vessel_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  plan_tier TEXT NOT NULL CHECK (plan_tier IN ('1_5', '6_10', '11_15', '16_25', '26_40', '40_plus')),
  billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly', '3_months', '6_months', '12_months')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  revenuecat_subscriber_id TEXT,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vessel_subscriptions_vessel_id ON public.vessel_subscriptions(vessel_id);
CREATE INDEX IF NOT EXISTS idx_vessel_subscriptions_stripe ON public.vessel_subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

ALTER TABLE public.vessel_subscriptions ENABLE ROW LEVEL SECURITY;

-- Vessel members (users with vessel_id) can read their vessel's subscription
CREATE POLICY "Vessel members can read vessel subscription"
  ON public.vessel_subscriptions
  FOR SELECT
  USING (vessel_id IN (SELECT vessel_id FROM public.users WHERE id = auth.uid()));

-- Only service role / webhooks can insert/update (Stripe, RevenueCat)
-- App uses RPC or Edge Functions for writes; direct client writes disabled
CREATE POLICY "No direct insert from client"
  ON public.vessel_subscriptions
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY "No direct update from client"
  ON public.vessel_subscriptions
  FOR UPDATE
  USING (false);

-- Allow service role to manage (webhooks run as service role)
-- RLS still applies; service role bypasses RLS by default in Supabase

COMMENT ON TABLE public.vessel_subscriptions IS 'Subscription plans for vessels; Captain pays before invite code access';
