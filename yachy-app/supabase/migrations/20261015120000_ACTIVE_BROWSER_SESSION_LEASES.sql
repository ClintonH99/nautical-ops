-- Approved policy: two concurrent browser installations, one hour since the
-- last foreground heartbeat. Authentication is independent of lease expiry.
-- Additive/test-gated rollout: NO account is opted in by this migration.
BEGIN;
CREATE TABLE public.browser_session_rollout (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE public.browser_session_rollout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.browser_session_rollout FROM PUBLIC, anon, authenticated;
ALTER TABLE public.user_devices ADD COLUMN lease_expires_at TIMESTAMPTZ;

CREATE FUNCTION public.browser_session_leases_enabled()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.browser_session_rollout
    WHERE user_id = auth.uid() AND enabled);
$$;
REVOKE ALL ON FUNCTION public.browser_session_leases_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.browser_session_leases_enabled() TO authenticated;

CREATE OR REPLACE FUNCTION public.register_user_device(
  p_device_fingerprint TEXT, p_platform TEXT, p_device_name TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller UUID := auth.uid();
  session_identifier UUID := NULLIF(auth.jwt()->>'session_id','')::UUID;
  existing public.user_devices%ROWTYPE;
  active_count INTEGER;
  leases BOOLEAN;
  checked_at TIMESTAMPTZ;
  metadata JSONB;
BEGIN
  IF caller IS NULL OR session_identifier IS NULL THEN
    RAISE EXCEPTION 'Authenticated session identifier required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(caller::TEXT, 0));
  checked_at := clock_timestamp();
  leases := public.browser_session_leases_enabled();
  metadata := CASE WHEN leases THEN jsonb_build_object(
    'mode','active_sessions','user_id',caller,'server_time',checked_at) ELSE '{}'::JSONB END;
  IF EXISTS (SELECT 1 FROM public.revoked_device_sessions
    WHERE user_id=caller AND session_id=session_identifier) THEN
    RETURN metadata || jsonb_build_object('allowed',FALSE,'reason','session_revoked');
  END IF;
  IF NOT leases THEN
    RETURN public.register_user_device_internal(p_device_fingerprint,p_platform,p_device_name);
  END IF;
  IF p_device_fingerprint IS NULL OR length(trim(p_device_fingerprint)) < 16
    OR length(p_device_fingerprint) > 256 OR p_platform NOT IN ('web','ios','android')
    OR p_platform IS NULL THEN RAISE EXCEPTION 'Invalid browser identity'; END IF;

  SELECT * INTO existing FROM public.user_devices
    WHERE user_id=caller AND device_fingerprint=p_device_fingerprint;
  SELECT count(*) INTO active_count FROM public.user_devices WHERE user_id=caller
    AND revoked_at IS NULL AND COALESCE(lease_expires_at,last_seen_at+INTERVAL '1 hour')>checked_at;
  IF NOT (existing.id IS NOT NULL AND existing.revoked_at IS NULL
      AND COALESCE(existing.lease_expires_at,existing.last_seen_at+INTERVAL '1 hour')>checked_at)
    AND active_count>=2 THEN
    RETURN metadata || jsonb_build_object('allowed',FALSE,'active_device_count',active_count,
      'reason','active_session_limit');
  END IF;

  -- Existing identity is reused. Expiry alone never writes revoked_at or
  -- revoked_device_sessions. Explicit removal/replacement still does so.
  INSERT INTO public.user_devices(user_id,device_fingerprint,session_id,platform,device_name,
    last_seen_at,lease_expires_at)
  VALUES(caller,p_device_fingerprint,session_identifier,p_platform,left(p_device_name,120),
    checked_at,checked_at+INTERVAL '1 hour')
  ON CONFLICT(user_id,device_fingerprint) DO UPDATE SET
    session_id=EXCLUDED.session_id,platform=EXCLUDED.platform,device_name=EXCLUDED.device_name,
    last_seen_at=EXCLUDED.last_seen_at,lease_expires_at=EXCLUDED.lease_expires_at,revoked_at=NULL;
  SELECT count(*) INTO active_count FROM public.user_devices WHERE user_id=caller
    AND revoked_at IS NULL AND COALESCE(lease_expires_at,last_seen_at+INTERVAL '1 hour')>checked_at;
  RETURN metadata || jsonb_build_object('allowed',TRUE,'active_device_count',active_count,
    'lease_expires_at',checked_at+INTERVAL '1 hour');
END;
$$;

-- Both RLS and service-role Edge Function authorization already call this
-- guard. An expired lease cannot access protected records with a valid JWT.
CREATE OR REPLACE FUNCTION public.current_session_has_registered_device()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.revoked_device_sessions r
      WHERE r.user_id=auth.uid() AND r.session_id::TEXT=auth.jwt()->>'session_id'
  ) AND EXISTS (SELECT 1 FROM public.user_devices d WHERE d.user_id=auth.uid()
    AND d.revoked_at IS NULL AND d.session_id::TEXT=auth.jwt()->>'session_id'
    AND (NOT public.browser_session_leases_enabled()
      OR COALESCE(d.lease_expires_at,d.last_seen_at+INTERVAL '1 hour')>statement_timestamp()));
$$;

-- A blocked but authenticated user may see only their own slot labels/times.
-- This does not authorize removal or expose fingerprints/session credentials.
CREATE FUNCTION public.list_active_browser_sessions()
RETURNS TABLE(id UUID,device_name TEXT,platform TEXT,last_seen_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,is_current BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.browser_session_leases_enabled()
    OR NULLIF(auth.jwt()->>'session_id','') IS NULL OR EXISTS (
      SELECT 1 FROM public.revoked_device_sessions WHERE user_id=auth.uid()
      AND session_id::TEXT=auth.jwt()->>'session_id') THEN
    RAISE EXCEPTION 'Authenticated active-session account required';
  END IF;
  RETURN QUERY SELECT d.id,d.device_name,d.platform,d.last_seen_at,
    COALESCE(d.lease_expires_at,d.last_seen_at+INTERVAL '1 hour'),
    COALESCE(d.session_id::TEXT=auth.jwt()->>'session_id',FALSE)
    FROM public.user_devices d WHERE d.user_id=auth.uid() AND d.revoked_at IS NULL
    AND COALESCE(d.lease_expires_at,d.last_seen_at+INTERVAL '1 hour')>statement_timestamp()
    ORDER BY d.first_seen_at,d.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_account_devices(p_challenge UUID DEFAULT NULL)
RETURNS TABLE(id UUID,device_name TEXT,platform TEXT,last_seen_at TIMESTAMPTZ,is_current BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (CASE WHEN p_challenge IS NOT NULL
    THEN public.device_recovery_is_verified(p_challenge)
    ELSE public.current_session_has_registered_device() END) THEN
    RAISE EXCEPTION 'Verify your account or use an approved device to manage devices';
  END IF;
  RETURN QUERY SELECT d.id,d.device_name,d.platform,d.last_seen_at,
    COALESCE(d.session_id::TEXT=auth.jwt()->>'session_id',FALSE)
    FROM public.user_devices d WHERE d.user_id=auth.uid() AND d.revoked_at IS NULL
    AND (NOT public.browser_session_leases_enabled()
      OR COALESCE(d.lease_expires_at,d.last_seen_at+INTERVAL '1 hour')>statement_timestamp())
    ORDER BY d.first_seen_at,d.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_device_recovery(
  p_challenge UUID,p_remove_device_ids UUID[],p_device_fingerprint TEXT,
  p_platform TEXT,p_device_name TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE selected_count INTEGER; active_count INTEGER; result JSONB; leases BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::TEXT,0));
  leases:=public.browser_session_leases_enabled();
  IF EXISTS (SELECT 1 FROM public.device_recovery_challenges WHERE id=p_challenge
    AND user_id=auth.uid() AND consumed_at IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.user_devices WHERE user_id=auth.uid() AND revoked_at IS NULL
      AND device_fingerprint=p_device_fingerprint AND session_id::TEXT=auth.jwt()->>'session_id'
      AND (NOT leases OR COALESCE(lease_expires_at,last_seen_at+INTERVAL '1 hour')>clock_timestamp())) THEN
    RETURN jsonb_build_object('allowed',TRUE);
  END IF;
  IF NOT public.device_recovery_is_verified(p_challenge) THEN
    RAISE EXCEPTION 'Recovery verification expired. Start again with your email and password';
  END IF;
  SELECT count(*) INTO active_count FROM public.user_devices WHERE user_id=auth.uid()
    AND revoked_at IS NULL AND (NOT leases OR COALESCE(lease_expires_at,last_seen_at+INTERVAL '1 hour')>clock_timestamp());
  SELECT count(DISTINCT value) INTO selected_count FROM unnest(p_remove_device_ids) AS value;
  IF (active_count>0 AND selected_count=0) OR selected_count<>COALESCE(cardinality(p_remove_device_ids),0) THEN
    RAISE EXCEPTION 'Select at least one session to end';
  END IF;
  IF selected_count<>(SELECT count(*) FROM public.user_devices WHERE id=ANY(p_remove_device_ids)
    AND user_id=auth.uid() AND revoked_at IS NULL
    AND (NOT leases OR COALESCE(lease_expires_at,last_seen_at+INTERVAL '1 hour')>clock_timestamp())) THEN
    RAISE EXCEPTION 'Session list changed. Refresh and choose again';
  END IF;
  UPDATE public.user_devices SET revoked_at=clock_timestamp(),session_id=NULL
    WHERE user_id=auth.uid() AND id=ANY(p_remove_device_ids);
  result:=public.register_user_device(p_device_fingerprint,p_platform,p_device_name);
  IF result->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'End another session before continuing'; END IF;
  UPDATE public.device_recovery_challenges SET consumed_at=clock_timestamp() WHERE id=p_challenge;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.list_active_browser_sessions() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_active_browser_sessions() TO authenticated;
-- CREATE OR REPLACE preserves the existing restricted grants on other RPCs.
COMMENT ON TABLE public.browser_session_rollout IS
  'Server-only opt-in for one-hour/two-active-browser testing. Empty by default; no third-slot grace.';
NOTIFY pgrst,'reload schema';
COMMIT;
