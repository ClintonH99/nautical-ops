-- LOCAL CANDIDATE ONLY. Deploy with the matching webhook and reviewed paid-only
-- Paddle catalogue. Never deletes a vessel, member, record or billing history.
-- Release order: approve/verify paid-only catalogue, configure environment-
-- specific PADDLE_PAID_PRICE_IDS / PADDLE_LIVE_PAID_PRICE_IDS, deploy payment-
-- verifying webhook, apply this migration, deploy reactivation function + UI.
-- First prove the full sequence in an isolated sandbox. Do not roll the webhook
-- back to a version that cannot recognize paid-only prices after first use.
-- This migration alone does not enable the existing RLS enforcement switch;
-- verify its live state before claiming direct-data protection is enforced.
ALTER TABLE public.paddle_checkout_intents
  ADD COLUMN previous_subscription_id TEXT REFERENCES public.paddle_subscription_links(subscription_id),
  ADD COLUMN expected_customer_id TEXT;

CREATE FUNCTION public.get_paddle_reactivation_billing(p_vessel_id UUID, p_environment TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result JSONB;
BEGIN
  IF p_environment IS NULL OR p_environment NOT IN ('sandbox','live') THEN RAISE EXCEPTION 'Invalid billing environment'; END IF;
  IF auth.uid() IS NULL OR NOT public.current_session_has_device_access() OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id=auth.uid() AND vessel_id=p_vessel_id AND role='CAPTAIN_MOV'
  ) THEN RAISE EXCEPTION 'Captain/MOV membership and a registered device required'; END IF;
  SELECT jsonb_build_object('subscription_id',l.subscription_id,'customer_id',l.customer_id,
    'environment',l.environment,'plan_tier',s.plan_tier,'billing_period',s.billing_period)
    INTO result FROM public.paddle_subscription_links l
    JOIN public.vessel_subscriptions s ON s.vessel_id=l.vessel_id
      AND s.paddle_subscription_id=l.subscription_id AND s.payment_provider='paddle'
    WHERE l.vessel_id=p_vessel_id AND l.environment=p_environment
      AND l.provider_status='canceled' AND s.status='canceled' AND s.current_period_end <= now();
  IF result IS NULL THEN RAISE EXCEPTION 'A confirmed expired subscription is required'; END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_paddle_reactivation_billing(UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_paddle_reactivation_billing(UUID,TEXT) TO authenticated;

CREATE FUNCTION public.reserve_paddle_reactivation(p_vessel_id UUID, p_environment TEXT,
  p_subscription_id TEXT, p_price_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE billing JSONB; intent public.paddle_checkout_intents%ROWTYPE;
BEGIN
  -- Serialize competing Captains and re-check the current entitlement under lock.
  PERFORM 1 FROM public.vessels WHERE id=p_vessel_id AND NOT is_solo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A shared vessel is required'; END IF;
  billing := public.get_paddle_reactivation_billing(p_vessel_id,p_environment);
  IF billing->>'subscription_id' IS DISTINCT FROM p_subscription_id
    OR p_price_id IS NULL OR p_price_id !~ '^pri_[a-z0-9]{26}$'
  THEN RAISE EXCEPTION 'Subscription or price changed'; END IF;
  SELECT * INTO intent FROM public.paddle_checkout_intents
    WHERE vessel_id=p_vessel_id AND state IN ('creating','ready') FOR UPDATE;
  IF FOUND THEN
    IF intent.previous_subscription_id IS DISTINCT FROM p_subscription_id
      OR intent.expected_customer_id IS DISTINCT FROM billing->>'customer_id'
      OR intent.environment <> p_environment OR intent.price_id <> p_price_id
      OR intent.plan_tier <> billing->>'plan_tier' OR intent.billing_period <> billing->>'billing_period'
    THEN RAISE EXCEPTION 'Resolve the existing checkout first'; END IF;
    RETURN jsonb_build_object('id',intent.id,'state',intent.state,'transaction_id',intent.transaction_id,'created',false);
  END IF;
  INSERT INTO public.paddle_checkout_intents(vessel_id,user_id,environment,plan_tier,billing_period,
    price_id,flow,previous_subscription_id,expected_customer_id)
    VALUES(p_vessel_id,auth.uid(),p_environment,billing->>'plan_tier',billing->>'billing_period',
      p_price_id,'checkout',p_subscription_id,billing->>'customer_id') RETURNING * INTO intent;
  RETURN jsonb_build_object('id',intent.id,'state',intent.state,'created',true);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_paddle_reactivation(UUID,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_paddle_reactivation(UUID,TEXT,TEXT,TEXT) TO authenticated;

-- Additive, deploy together with the enriched signed webhook. No data deletion.
-- Existing past-due rows require provider reconciliation before release.
CREATE OR REPLACE FUNCTION public.apply_paddle_subscription_event(p_event JSONB)
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
    -- Match the reservation's vessel -> intent lock order, avoiding a deadlock
    -- if the Captain retries as the first subscription notification arrives.
    PERFORM 1 FROM public.vessels WHERE id = (
      SELECT vessel_id FROM public.paddle_checkout_intents WHERE id = (p_event->>'checkout_id')::UUID
    ) FOR UPDATE;
    SELECT * INTO intent FROM public.paddle_checkout_intents WHERE id = (p_event->>'checkout_id')::UUID FOR UPDATE;
    IF NOT FOUND OR intent.state <> 'ready' OR intent.environment <> p_event->>'environment'
      OR intent.transaction_id IS DISTINCT FROM p_event->>'transaction_id'
      OR intent.transaction_id IS NULL OR intent.plan_tier <> p_event->>'plan_tier'
      OR intent.billing_period <> p_event->>'billing_period'
    THEN RAISE EXCEPTION 'Subscription has no verified checkout binding'; END IF;
    IF p_event->'no_trial_price' = 'true'::JSONB AND (
      intent.previous_subscription_id IS NULL OR
      p_event->'initial_payment_verified' IS DISTINCT FROM 'true'::JSONB
    ) THEN RAISE EXCEPTION 'Confirmed paid reactivation required'; END IF;
    IF intent.previous_subscription_id IS NOT NULL AND (
      p_event->'initial_payment_verified' IS DISTINCT FROM 'true'::JSONB
      OR p_event->'no_trial_price' IS DISTINCT FROM 'true'::JSONB
      OR p_event->>'status' IS DISTINCT FROM 'active'
      OR intent.price_id IS DISTINCT FROM p_event->>'price_id'
      OR intent.expected_customer_id IS DISTINCT FROM p_event->>'customer_id'
    ) THEN RAISE EXCEPTION 'Confirmed paid reactivation required'; END IF;
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
  IF existing.paddle_subscription_id IS DISTINCT FROM link.subscription_id AND intent.previous_subscription_id IS NOT NULL
    AND (existing.paddle_subscription_id IS DISTINCT FROM intent.previous_subscription_id
      OR existing.status <> 'canceled' OR existing.current_period_end > now())
  THEN RAISE EXCEPTION 'Previous subscription changed'; END IF;
  -- Never let a late notification from an archived subscription overwrite its replacement.
  IF existing.paddle_subscription_id IS DISTINCT FROM link.subscription_id AND link.last_event_at IS NOT NULL THEN
    INSERT INTO public.paddle_processed_events(event_id,subscription_id,occurred_at)
      VALUES(p_event->>'event_id',link.subscription_id,event_at);
    RETURN 'superseded';
  END IF;
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
    -- This evidence is added by the signed webhook handler after reading Paddle
    -- transactions. Missing evidence is an outage, NOT proof of nonpayment.
    IF p_event->'paid_history_verified' IS DISTINCT FROM 'true'::JSONB
      OR jsonb_typeof(p_event->'previously_paid') IS DISTINCT FROM 'boolean'
      OR period_start > event_at
    THEN RAISE EXCEPTION 'Verified payment history required'; END IF;
    -- A first failed payment has no renewal grace. Set an explicit past date;
    -- NULL would trigger the legacy Apple/Google 16-day fallback.
    grace_end := period_start + CASE WHEN (p_event->>'previously_paid')::BOOLEAN
      THEN INTERVAL '16 days' ELSE INTERVAL '0 days' END;
    IF existing.paddle_subscription_id = link.subscription_id AND existing.status = 'past_due' THEN
      grace_end := LEAST(grace_end, existing.grace_period_end);
    END IF;
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


-- Keep the existing server-side access boundary; only expired Paddle trials
-- change. Paid-renewal uncertainty and legacy-provider behavior are unchanged.

CREATE OR REPLACE FUNCTION public.vessel_subscription_allows_access(target_vessel_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  subscription_row public.vessel_subscriptions%ROWTYPE;
  paid_through TIMESTAMPTZ;
  grace_through TIMESTAMPTZ;
BEGIN
  SELECT *
  INTO subscription_row
  FROM public.vessel_subscriptions
  WHERE vessel_id = target_vessel_id
  ORDER BY current_period_end DESC
  LIMIT 1;

  -- The overdue-payment restriction applies only to a vessel that previously
  -- had a paid subscription. A missing row is not proof of failed payment.
  IF NOT FOUND THEN
    RETURN TRUE;
  END IF;

  IF subscription_row.status = 'revoked' THEN
    RETURN FALSE;
  END IF;

  paid_through := subscription_row.current_period_end;
  IF paid_through > now() AND subscription_row.status <> 'past_due' THEN
    RETURN TRUE;
  END IF;

  -- A confirmed trial deadline grants no paid renewal time. Expired paid/legacy
  -- states still preserve existing behavior during provider uncertainty.
  IF subscription_row.payment_provider = 'paddle' AND subscription_row.status = 'trialing' THEN
    RETURN FALSE;
  END IF;
  IF subscription_row.status IN ('active', 'trialing') THEN
    RETURN TRUE;
  END IF;

  IF subscription_row.status = 'past_due' THEN
    grace_through := COALESCE(
      subscription_row.grace_period_end,
      paid_through + INTERVAL '16 days'
    );
    RETURN grace_through > now();
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.vessel_subscription_allows_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vessel_subscription_allows_access(UUID) TO authenticated;
