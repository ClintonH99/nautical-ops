-- Additive only: no subscriptions, memberships or deployment switches changed.
-- Old sandbox RPC signatures remain available for previously deployed clients.
CREATE FUNCTION public.reserve_paddle_trial(
  p_vessel_id UUID, p_plan_tier TEXT, p_billing_period TEXT, p_price_id TEXT,
  p_environment TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE intent public.paddle_checkout_intents%ROWTYPE;
BEGIN
  IF p_environment IS NULL OR p_environment NOT IN ('sandbox','live')
    THEN RAISE EXCEPTION 'Invalid billing environment'; END IF;
  IF auth.uid() IS NULL OR NOT public.current_session_has_device_access() OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id=auth.uid() AND vessel_id=p_vessel_id AND role='CAPTAIN_MOV'
  ) THEN RAISE EXCEPTION 'Captain/MOV membership and a registered device required'; END IF;
  PERFORM 1 FROM public.vessels WHERE id=p_vessel_id AND NOT is_solo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A shared vessel is required'; END IF;
  IF EXISTS (SELECT 1 FROM public.vessel_subscriptions WHERE vessel_id=p_vessel_id)
    OR EXISTS (SELECT 1 FROM public.paddle_subscription_links WHERE vessel_id=p_vessel_id)
    OR EXISTS (SELECT 1 FROM public.paddle_checkout_intents WHERE vessel_id=p_vessel_id AND state='completed')
  THEN RAISE EXCEPTION 'Manage the existing subscription; a second trial is not allowed'; END IF;
  SELECT * INTO intent FROM public.paddle_checkout_intents
    WHERE vessel_id=p_vessel_id AND state IN ('creating','ready') FOR UPDATE;
  IF FOUND THEN
    IF intent.flow <> 'cardless_trial' OR intent.environment <> p_environment
      OR intent.plan_tier <> p_plan_tier OR intent.billing_period <> p_billing_period
      OR intent.price_id <> p_price_id
    THEN RAISE EXCEPTION 'Resolve the existing billing request first'; END IF;
    RETURN jsonb_build_object('id',intent.id,'state',intent.state,
      'transaction_id',intent.transaction_id,'created',false);
  END IF;
  INSERT INTO public.paddle_checkout_intents
    (vessel_id,user_id,environment,plan_tier,billing_period,price_id,flow)
    VALUES(p_vessel_id,auth.uid(),p_environment,p_plan_tier,p_billing_period,p_price_id,'cardless_trial')
    RETURNING * INTO intent;
  RETURN jsonb_build_object('id',intent.id,'state',intent.state,'created',true);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_paddle_trial(UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_paddle_trial(UUID,TEXT,TEXT,TEXT,TEXT) TO authenticated;

-- This lookup intentionally works during payment lockout, but never bypasses
-- Captain/MOV membership or device access. No provider IDs come from the client.
CREATE FUNCTION public.get_paddle_management_billing(p_vessel_id UUID, p_environment TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result JSONB;
BEGIN
  IF p_environment IS NULL OR p_environment NOT IN ('sandbox','live')
    THEN RAISE EXCEPTION 'Invalid billing environment'; END IF;
  IF auth.uid() IS NULL OR NOT public.current_session_has_device_access() OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id=auth.uid() AND vessel_id=p_vessel_id AND role='CAPTAIN_MOV'
  ) THEN RAISE EXCEPTION 'Captain/MOV membership and a registered device required'; END IF;
  SELECT jsonb_build_object('subscription_id',l.subscription_id,'customer_id',l.customer_id,
    'environment',l.environment,'provider_status',l.provider_status,'status',s.status,
    'period_end',s.current_period_end,'trial_end',s.current_period_end,
    'cancel_at',l.cancel_at,'plan_tier',s.plan_tier,'billing_period',s.billing_period)
    INTO result FROM public.paddle_subscription_links l
    JOIN public.vessel_subscriptions s ON s.vessel_id=l.vessel_id
      AND s.paddle_subscription_id=l.subscription_id AND s.payment_provider='paddle'
    WHERE l.vessel_id=p_vessel_id AND l.environment=p_environment;
  IF result IS NULL THEN RAISE EXCEPTION 'A confirmed subscription in this environment is required'; END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_paddle_management_billing(UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_paddle_management_billing(UUID,TEXT) TO authenticated;

CREATE FUNCTION public.get_paddle_trial_billing(p_vessel_id UUID, p_environment TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result JSONB;
BEGIN
  result := public.get_paddle_management_billing(p_vessel_id,p_environment);
  IF result->>'provider_status' IS DISTINCT FROM 'trialing'
    OR result->>'status' IS DISTINCT FROM 'trialing' OR result->>'cancel_at' IS NOT NULL
    OR (result->>'trial_end')::TIMESTAMPTZ IS NULL
    OR (result->>'trial_end')::TIMESTAMPTZ <= now()
  THEN RAISE EXCEPTION 'A confirmed, uncancelled trial is required'; END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_paddle_trial_billing(UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_paddle_trial_billing(UUID,TEXT) TO authenticated;

CREATE FUNCTION public.get_paddle_recovery_billing(p_vessel_id UUID, p_environment TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result JSONB;
BEGIN
  result := public.get_paddle_management_billing(p_vessel_id,p_environment);
  IF result->>'provider_status' IS DISTINCT FROM 'past_due'
    OR result->>'status' IS DISTINCT FROM 'past_due'
  THEN RAISE EXCEPTION 'A confirmed past-due subscription is required'; END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_paddle_recovery_billing(UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_paddle_recovery_billing(UUID,TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
