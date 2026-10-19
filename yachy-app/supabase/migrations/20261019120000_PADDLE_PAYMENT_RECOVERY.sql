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

CREATE FUNCTION public.get_paddle_recovery_billing(p_vessel_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_session_has_device_access() OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id=auth.uid() AND vessel_id=p_vessel_id AND role='CAPTAIN_MOV'
  ) THEN RAISE EXCEPTION 'Captain/MOV membership and a registered device required'; END IF;
  SELECT jsonb_build_object('subscription_id',l.subscription_id,'customer_id',l.customer_id,
    'environment',l.environment) INTO result
    FROM public.paddle_subscription_links l
    JOIN public.vessel_subscriptions s ON s.vessel_id=l.vessel_id
      AND s.paddle_subscription_id=l.subscription_id AND s.payment_provider='paddle'
    WHERE l.vessel_id=p_vessel_id AND l.environment='sandbox'
      AND l.provider_status='past_due' AND s.status='past_due';
  IF result IS NULL THEN RAISE EXCEPTION 'A confirmed past-due sandbox subscription is required'; END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_paddle_recovery_billing(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_paddle_recovery_billing(UUID) TO authenticated;
