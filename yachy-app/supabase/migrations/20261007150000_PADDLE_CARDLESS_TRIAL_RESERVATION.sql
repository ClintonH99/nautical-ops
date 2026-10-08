-- Does not enable billing. Used only by the separately gated sandbox trial flow.
ALTER TABLE public.paddle_checkout_intents ADD COLUMN flow TEXT NOT NULL DEFAULT 'checkout'
  CHECK (flow IN ('checkout', 'cardless_trial'));

CREATE FUNCTION public.reserve_paddle_trial(
  p_vessel_id UUID, p_plan_tier TEXT, p_billing_period TEXT, p_price_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE intent public.paddle_checkout_intents%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_session_has_device_access() OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id=auth.uid() AND vessel_id=p_vessel_id AND role='CAPTAIN_MOV'
  ) THEN RAISE EXCEPTION 'Captain/MOV membership and a registered device required'; END IF;
  PERFORM 1 FROM public.vessels WHERE id=p_vessel_id AND NOT is_solo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A shared vessel is required'; END IF;
  -- A canceled or expired subscription is still evidence of a prior trial.
  IF EXISTS (SELECT 1 FROM public.vessel_subscriptions WHERE vessel_id=p_vessel_id)
    OR EXISTS (SELECT 1 FROM public.paddle_subscription_links WHERE vessel_id=p_vessel_id)
    OR EXISTS (SELECT 1 FROM public.paddle_checkout_intents WHERE vessel_id=p_vessel_id AND state='completed')
  THEN RAISE EXCEPTION 'Manage the existing subscription; a second trial is not allowed'; END IF;
  SELECT * INTO intent FROM public.paddle_checkout_intents
    WHERE vessel_id=p_vessel_id AND state IN ('creating','ready') FOR UPDATE;
  IF FOUND THEN
    IF intent.flow <> 'cardless_trial' OR intent.environment <> 'sandbox'
      OR intent.plan_tier <> p_plan_tier OR intent.billing_period <> p_billing_period
      OR intent.price_id <> p_price_id
    THEN RAISE EXCEPTION 'Resolve the existing billing request first'; END IF;
    RETURN jsonb_build_object('id',intent.id,'state',intent.state,
      'transaction_id',intent.transaction_id,'created',false);
  END IF;
  INSERT INTO public.paddle_checkout_intents
    (vessel_id,user_id,environment,plan_tier,billing_period,price_id,flow)
    VALUES(p_vessel_id,auth.uid(),'sandbox',p_plan_tier,p_billing_period,p_price_id,'cardless_trial')
    RETURNING * INTO intent;
  RETURN jsonb_build_object('id',intent.id,'state',intent.state,'created',true);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_paddle_trial(UUID,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_paddle_trial(UUID,TEXT,TEXT,TEXT) TO authenticated;

-- The caller supplies a vessel, never an arbitrary Paddle customer/subscription.
CREATE FUNCTION public.get_paddle_trial_billing(p_vessel_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_session_has_device_access() OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id=auth.uid() AND vessel_id=p_vessel_id AND role='CAPTAIN_MOV'
  ) THEN RAISE EXCEPTION 'Captain/MOV membership and a registered device required'; END IF;
  SELECT jsonb_build_object('subscription_id',l.subscription_id,'customer_id',l.customer_id,
    'environment',l.environment,'trial_end',s.current_period_end,
    'plan_tier',s.plan_tier,'billing_period',s.billing_period)
    INTO result FROM public.paddle_subscription_links l
    JOIN public.vessel_subscriptions s ON s.vessel_id=l.vessel_id
      AND s.paddle_subscription_id=l.subscription_id AND s.payment_provider='paddle'
    WHERE l.vessel_id=p_vessel_id AND l.environment='sandbox'
      AND l.provider_status='trialing' AND l.cancel_at IS NULL
      AND s.status='trialing' AND s.current_period_end > now();
  IF result IS NULL THEN RAISE EXCEPTION 'A confirmed, uncancelled sandbox trial is required'; END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_paddle_trial_billing(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_paddle_trial_billing(UUID) TO authenticated;
