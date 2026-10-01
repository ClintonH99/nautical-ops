-- Additive web migration. Does not retire Apple test entitlements or enable checkout.
-- Apply only with the matching web release; provider secrets stay server-side.
CREATE TABLE public.paddle_checkout_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  plan_tier TEXT NOT NULL CHECK (plan_tier IN ('1_5','6_10','11_15','16_25','26_40','40_plus')),
  billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly','3_months','6_months','12_months')),
  price_id TEXT NOT NULL,
  transaction_id TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'creating' CHECK (state IN ('creating','ready','completed','canceled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX paddle_one_open_checkout_per_vessel ON public.paddle_checkout_intents(vessel_id)
  WHERE state IN ('creating','ready');
CREATE TABLE public.paddle_subscription_links (
  subscription_id TEXT PRIMARY KEY,
  checkout_id UUID NOT NULL UNIQUE REFERENCES public.paddle_checkout_intents(id),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox','live')),
  last_event_at TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  provider_status TEXT NOT NULL
);
CREATE TABLE public.paddle_processed_events (
  event_id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.paddle_checkout_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paddle_subscription_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paddle_processed_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paddle_checkout_intents, public.paddle_subscription_links, public.paddle_processed_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.paddle_checkout_intents, public.paddle_subscription_links, public.paddle_processed_events TO service_role;

CREATE FUNCTION public.reserve_paddle_checkout(p_vessel_id UUID, p_plan_tier TEXT, p_billing_period TEXT, p_environment TEXT, p_price_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE intent public.paddle_checkout_intents%ROWTYPE;
BEGIN
  IF NOT public.current_session_has_device_access() OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND vessel_id = p_vessel_id AND role = 'CAPTAIN_MOV'
  ) THEN RAISE EXCEPTION 'Captain/MOV membership and a registered device required'; END IF;
  -- Serialize against other Captains starting a purchase on the same vessel.
  PERFORM 1 FROM public.vessels WHERE id = p_vessel_id AND NOT is_solo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A shared vessel is required'; END IF;
  IF EXISTS (SELECT 1 FROM public.vessel_subscriptions WHERE vessel_id = p_vessel_id
    AND (status NOT IN ('canceled','revoked') OR current_period_end > now()))
  THEN RAISE EXCEPTION 'Manage the existing subscription instead of purchasing another'; END IF;
  SELECT * INTO intent FROM public.paddle_checkout_intents WHERE vessel_id = p_vessel_id AND state IN ('creating','ready');
  IF FOUND THEN
    IF intent.plan_tier <> p_plan_tier OR intent.billing_period <> p_billing_period
      OR intent.environment <> p_environment OR intent.price_id <> p_price_id
    THEN RAISE EXCEPTION 'Resolve the existing checkout before selecting another plan'; END IF;
    RETURN jsonb_build_object('id', intent.id, 'state', intent.state, 'transaction_id', intent.transaction_id, 'created', false);
  END IF;
  INSERT INTO public.paddle_checkout_intents(vessel_id,user_id,environment,plan_tier,billing_period,price_id)
    VALUES(p_vessel_id,auth.uid(),p_environment,p_plan_tier,p_billing_period,p_price_id) RETURNING * INTO intent;
  RETURN jsonb_build_object('id', intent.id, 'state', intent.state, 'created', true);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_paddle_checkout(UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_paddle_checkout(UUID,TEXT,TEXT,TEXT,TEXT) TO authenticated;

CREATE FUNCTION public.apply_paddle_subscription_event(p_event JSONB)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  link public.paddle_subscription_links%ROWTYPE;
  intent public.paddle_checkout_intents%ROWTYPE;
  existing public.vessel_subscriptions%ROWTYPE;
  event_at TIMESTAMPTZ := (p_event->>'occurred_at')::TIMESTAMPTZ;
  period_start TIMESTAMPTZ := (p_event->>'period_start')::TIMESTAMPTZ;
  period_end TIMESTAMPTZ := (p_event->>'period_end')::TIMESTAMPTZ;
  scheduled_cancel_at TIMESTAMPTZ := (p_event->>'cancel_at')::TIMESTAMPTZ;
  mapped_status TEXT;
  grace_end TIMESTAMPTZ;
BEGIN
  IF p_event->>'event_id' IS NULL OR event_at IS NULL OR p_event->>'subscription_id' IS NULL
    OR p_event->>'environment' NOT IN ('sandbox','live') OR p_event->>'customer_id' IS NULL
    OR p_event->>'status' NOT IN ('active','trialing','past_due','paused','canceled')
  THEN RAISE EXCEPTION 'Invalid provider event'; END IF;
  -- Serialize first bindings too, before a subscription-link row exists.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event->>'subscription_id', 0));
  IF EXISTS (SELECT 1 FROM public.paddle_processed_events WHERE event_id = p_event->>'event_id') THEN RETURN 'duplicate'; END IF;
  SELECT * INTO link FROM public.paddle_subscription_links WHERE subscription_id = p_event->>'subscription_id' FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO intent FROM public.paddle_checkout_intents WHERE id = (p_event->>'checkout_id')::UUID FOR UPDATE;
    IF NOT FOUND OR intent.state <> 'ready' OR intent.environment <> p_event->>'environment'
      OR intent.transaction_id IS DISTINCT FROM p_event->>'transaction_id'
      OR intent.transaction_id IS NULL OR intent.plan_tier <> p_event->>'plan_tier'
      OR intent.billing_period <> p_event->>'billing_period'
    THEN RAISE EXCEPTION 'Subscription has no verified checkout binding'; END IF;
    INSERT INTO public.paddle_subscription_links(subscription_id,checkout_id,vessel_id,customer_id,environment,provider_status)
      VALUES(p_event->>'subscription_id',intent.id,intent.vessel_id,p_event->>'customer_id',intent.environment,p_event->>'status') RETURNING * INTO link;
  END IF;
  IF link.environment <> p_event->>'environment' OR link.customer_id <> p_event->>'customer_id'
  THEN RAISE EXCEPTION 'Provider binding mismatch'; END IF;
  IF link.last_event_at IS NOT NULL AND event_at <= link.last_event_at THEN
    INSERT INTO public.paddle_processed_events(event_id,subscription_id,occurred_at) VALUES(p_event->>'event_id',link.subscription_id,event_at);
    RETURN 'stale';
  END IF;
  PERFORM 1 FROM public.vessels WHERE id = link.vessel_id FOR UPDATE;
  SELECT * INTO existing FROM public.vessel_subscriptions WHERE vessel_id = link.vessel_id FOR UPDATE;
  IF FOUND AND existing.paddle_subscription_id IS DISTINCT FROM link.subscription_id
    AND (link.last_event_at IS NOT NULL OR existing.status NOT IN ('canceled','revoked') OR existing.current_period_end > now())
  THEN RAISE EXCEPTION 'Another entitlement already belongs to this vessel'; END IF;
  IF p_event->>'status' IN ('paused','canceled') THEN
    period_start := COALESCE(period_start, existing.current_period_start);
    period_end := COALESCE(period_end, existing.current_period_end);
    IF p_event->>'status' = 'canceled' THEN period_end := LEAST(period_end, COALESCE((p_event->>'canceled_at')::TIMESTAMPTZ, event_at)); END IF;
  END IF;
  IF period_start IS NULL OR period_end IS NULL THEN RAISE EXCEPTION 'Provider billing dates are required'; END IF;
  -- Existing revoked access semantics safely deny paused subscriptions without
  -- broadening the legacy status enum. Original Paddle state is retained above.
  mapped_status := CASE WHEN p_event->>'status' = 'paused' THEN 'revoked'
    WHEN scheduled_cancel_at IS NOT NULL AND p_event->>'status' IN ('active','trialing') THEN 'canceled'
    ELSE p_event->>'status' END;
  IF scheduled_cancel_at IS NOT NULL THEN period_end := LEAST(period_end, scheduled_cancel_at); END IF;
  IF mapped_status = 'past_due' THEN
    -- Repeated dunning updates must never restart the approved 16-day window.
    grace_end := CASE WHEN existing.paddle_subscription_id = link.subscription_id AND existing.status = 'past_due'
      THEN COALESCE(existing.grace_period_end, existing.current_period_end + INTERVAL '16 days')
      WHEN existing.paddle_subscription_id = link.subscription_id THEN existing.current_period_end + INTERVAL '16 days'
      ELSE period_start + INTERVAL '16 days' END;
  END IF;
  INSERT INTO public.vessel_subscriptions(vessel_id,plan_tier,billing_period,status,paddle_subscription_id,paddle_customer_id,
    payment_provider,current_period_start,current_period_end,grace_period_end,last_verified_at,updated_at)
  VALUES(link.vessel_id,p_event->>'plan_tier',p_event->>'billing_period',mapped_status,link.subscription_id,link.customer_id,
    'paddle',period_start,period_end,grace_end,now(),now())
  ON CONFLICT(vessel_id) DO UPDATE SET plan_tier=EXCLUDED.plan_tier,billing_period=EXCLUDED.billing_period,status=EXCLUDED.status,
    paddle_subscription_id=EXCLUDED.paddle_subscription_id,paddle_customer_id=EXCLUDED.paddle_customer_id,payment_provider='paddle',
    current_period_start=EXCLUDED.current_period_start,current_period_end=EXCLUDED.current_period_end,
    grace_period_end=EXCLUDED.grace_period_end,last_verified_at=now(),updated_at=now();
  UPDATE public.paddle_subscription_links SET last_event_at=event_at,cancel_at=scheduled_cancel_at,provider_status=p_event->>'status'
    WHERE subscription_id=link.subscription_id;
  UPDATE public.paddle_checkout_intents SET state='completed' WHERE id=link.checkout_id;
  INSERT INTO public.paddle_processed_events(event_id,subscription_id,occurred_at) VALUES(p_event->>'event_id',link.subscription_id,event_at);
  RETURN 'applied';
END;
$$;
REVOKE ALL ON FUNCTION public.apply_paddle_subscription_event(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paddle_subscription_event(JSONB) TO service_role;
