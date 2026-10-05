-- Separate from app-wide enforcement activation. Recovery requires BOTH a
-- recent password login and a subsequent email OTP, proven by signed claims.
CREATE TABLE public.device_recovery_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '10 minutes',
  consumed_at TIMESTAMPTZ
);
ALTER TABLE public.device_recovery_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_recovery_challenges FROM PUBLIC, anon, authenticated;

-- Never reveal installation fingerprints or session IDs to an unregistered
-- login. Device management uses the deliberately limited list RPC below.
REVOKE ALL ON public.user_devices FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.device_has_recent_auth(p_method TEXT, p_since TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(auth.jwt()->'amr') = 'array'
      THEN auth.jwt()->'amr' ELSE '[]'::JSONB END) AS entry
    WHERE entry->>'method' = p_method
      AND CASE WHEN entry->>'timestamp' ~ '^[0-9]{1,12}$'
        THEN (entry->>'timestamp')::BIGINT BETWEEN floor(extract(epoch FROM p_since))::BIGINT
          AND floor(extract(epoch FROM now() + INTERVAL '1 minute'))::BIGINT
        ELSE FALSE END
  );
$$;
REVOKE ALL ON FUNCTION public.device_has_recent_auth(TEXT,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.begin_device_recovery()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE challenge_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.device_has_recent_auth('password', now() - INTERVAL '5 minutes') THEN
    RAISE EXCEPTION 'Sign in with your email and password to start device recovery';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::TEXT, 0));
  DELETE FROM public.device_recovery_challenges WHERE user_id = auth.uid() AND expires_at < now();
  IF (SELECT count(*) FROM public.device_recovery_challenges WHERE user_id = auth.uid()
      AND created_at > now() - INTERVAL '10 minutes') >= 5 THEN
    RAISE EXCEPTION 'Too many recovery attempts. Please wait ten minutes and try again';
  END IF;
  INSERT INTO public.device_recovery_challenges(user_id) VALUES (auth.uid()) RETURNING id INTO challenge_id;
  RETURN challenge_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.device_recovery_is_verified(p_challenge UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.device_recovery_challenges AS challenge
    WHERE challenge.id = p_challenge AND challenge.user_id = auth.uid()
      AND challenge.consumed_at IS NULL AND challenge.expires_at > now()
      AND public.device_has_recent_auth('otp', challenge.created_at));
$$;
REVOKE ALL ON FUNCTION public.device_recovery_is_verified(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_account_devices(p_challenge UUID DEFAULT NULL)
RETURNS TABLE(id UUID, device_name TEXT, platform TEXT, last_seen_at TIMESTAMPTZ, is_current BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (CASE WHEN p_challenge IS NOT NULL
    THEN public.device_recovery_is_verified(p_challenge)
    ELSE public.current_session_has_registered_device() END) THEN
    RAISE EXCEPTION 'Verify your account or use an approved device to manage devices';
  END IF;
  RETURN QUERY SELECT d.id, d.device_name, d.platform, d.last_seen_at,
    COALESCE(d.session_id::TEXT = auth.jwt()->>'session_id', FALSE)
    FROM public.user_devices AS d WHERE d.user_id = auth.uid() AND d.revoked_at IS NULL
    ORDER BY d.first_seen_at, d.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_account_device(p_device_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::TEXT, 0));
  IF NOT public.current_session_has_registered_device() THEN RAISE EXCEPTION 'Use an approved device to remove a saved device'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_devices WHERE id = p_device_id AND user_id = auth.uid()
    AND session_id::TEXT = auth.jwt()->>'session_id') THEN
    RAISE EXCEPTION 'Use Sign Out to remove this device';
  END IF;
  UPDATE public.user_devices SET revoked_at = now(), session_id = NULL
    WHERE id = p_device_id AND user_id = auth.uid() AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device is no longer available. Refresh the list'; END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_device_recovery(
  p_challenge UUID, p_remove_device_ids UUID[], p_device_fingerprint TEXT,
  p_platform TEXT, p_device_name TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE selected_count INTEGER; active_count INTEGER; result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::TEXT, 0));
  -- A retry after a lost response must not remove a second device.
  IF EXISTS (SELECT 1 FROM public.device_recovery_challenges WHERE id=p_challenge
    AND user_id=auth.uid() AND consumed_at IS NOT NULL) AND EXISTS (
    SELECT 1 FROM public.user_devices WHERE user_id=auth.uid() AND revoked_at IS NULL
      AND device_fingerprint=p_device_fingerprint AND session_id::TEXT=auth.jwt()->>'session_id') THEN
    RETURN jsonb_build_object('allowed',true);
  END IF;
  IF NOT public.device_recovery_is_verified(p_challenge) THEN
    RAISE EXCEPTION 'Recovery verification expired. Start again with your email and password';
  END IF;
  SELECT count(*) INTO active_count FROM public.user_devices WHERE user_id=auth.uid() AND revoked_at IS NULL;
  SELECT count(DISTINCT value) INTO selected_count FROM unnest(p_remove_device_ids) AS value;
  IF (active_count > 0 AND selected_count = 0)
    OR selected_count <> COALESCE(cardinality(p_remove_device_ids),0) THEN
    RAISE EXCEPTION 'Select at least one saved device to remove';
  END IF;
  IF selected_count <> (SELECT count(*) FROM public.user_devices
    WHERE id = ANY(p_remove_device_ids) AND user_id=auth.uid() AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Device list changed. Refresh and choose again';
  END IF;
  UPDATE public.user_devices SET revoked_at=now(), session_id=NULL
    WHERE user_id=auth.uid() AND id=ANY(p_remove_device_ids);
  result := public.register_user_device(p_device_fingerprint,p_platform,p_device_name);
  IF result->>'allowed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Remove another saved device before continuing';
  END IF;
  UPDATE public.device_recovery_challenges SET consumed_at=now() WHERE id=p_challenge;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_device_recovery() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_account_devices(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_account_device(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_device_recovery(UUID,UUID[],TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_device_recovery() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_devices(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_account_device(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_device_recovery(UUID,UUID[],TEXT,TEXT,TEXT) TO authenticated;
