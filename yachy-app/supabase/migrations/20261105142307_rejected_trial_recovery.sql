-- Release only this invocation's definitely failed NEW cardless-trial request.
-- No historical cleanup, customer/subscription mutations or payment calls.
BEGIN;
ALTER TABLE public.paddle_checkout_intents
  ADD COLUMN failure_reason text,
  ADD COLUMN failure_request_id text,
  ADD COLUMN failed_at timestamptz;

CREATE FUNCTION public.release_failed_paddle_trial(
  p_intent_id uuid, p_vessel_id uuid, p_user_id uuid, p_environment text,
  p_reason text, p_request_id text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE changed integer;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN (
    'before_transaction_request','transaction_checkout_not_enabled',
    'transaction_checkout_url_domain_is_not_approved','transaction_default_checkout_url_not_set',
    'transaction_creation_blocked','invalid_field','invalid_json'
  ) OR p_environment IS NULL OR p_environment NOT IN ('live','sandbox')
    OR (p_request_id IS NOT NULL AND p_request_id !~ '^[a-zA-Z0-9_-]{1,100}$')
  THEN RETURN false; END IF;
  -- Same lock order as reservation: vessel, then intent. Serialize against a
  -- second Captain; retain the unique one-open-checkout-per-vessel index.
  PERFORM 1 FROM public.vessels WHERE id=p_vessel_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.vessel_subscriptions WHERE vessel_id=p_vessel_id)
    OR EXISTS(SELECT 1 FROM public.paddle_subscription_links WHERE vessel_id=p_vessel_id)
    OR EXISTS(SELECT 1 FROM public.paddle_checkout_intents WHERE vessel_id=p_vessel_id AND state='completed')
  THEN RETURN false; END IF;
  UPDATE public.paddle_checkout_intents SET state='canceled',failure_reason=p_reason,
    failure_request_id=p_request_id,failed_at=now()
  WHERE id=p_intent_id AND vessel_id=p_vessel_id AND user_id=p_user_id
    AND environment=p_environment AND flow='cardless_trial'
    AND state='creating' AND transaction_id IS NULL
    AND previous_subscription_id IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END;
$$;
REVOKE ALL ON FUNCTION public.release_failed_paddle_trial(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_failed_paddle_trial(uuid,uuid,uuid,text,text,text) TO service_role;
COMMIT;
