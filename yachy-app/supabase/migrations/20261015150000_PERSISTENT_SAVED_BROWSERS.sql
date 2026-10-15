-- Final approved policy: two saved browsers, no inactivity timeout.
-- Supersedes the opt-in lease experiment without deleting registration history.
BEGIN;
LOCK TABLE public.user_devices IN SHARE ROW EXCLUSIVE MODE;

-- Expired test leases were already unavailable. Do not resurrect them as
-- permanent third/fourth slots. Non-experimental accounts are untouched.
UPDATE public.user_devices d SET revoked_at=clock_timestamp(),session_id=NULL
WHERE d.revoked_at IS NULL
  AND EXISTS (SELECT 1 FROM public.browser_session_rollout r WHERE r.user_id=d.user_id AND r.enabled)
  AND COALESCE(d.lease_expires_at,d.last_seen_at+INTERVAL '1 hour')<=statement_timestamp();
DO $$ BEGIN
  IF EXISTS (SELECT user_id FROM public.user_devices WHERE revoked_at IS NULL GROUP BY user_id HAVING count(*)>2) THEN
    RAISE EXCEPTION 'More than two saved browsers exist; review before cutover';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.register_user_device(
  p_device_fingerprint TEXT,p_platform TEXT,p_device_name TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  caller UUID:=auth.uid();
  sid UUID:=NULLIF(auth.jwt()->>'session_id','')::UUID;
  existing public.user_devices%ROWTYPE;
  saved_count INTEGER;
  checked_at TIMESTAMPTZ;
  metadata JSONB;
BEGIN
  IF caller IS NULL OR sid IS NULL THEN RAISE EXCEPTION 'Authenticated session identifier required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(caller::TEXT,0));
  checked_at:=clock_timestamp();
  metadata:=jsonb_build_object('mode','saved_browsers','user_id',caller,'server_time',checked_at);
  IF EXISTS (SELECT 1 FROM public.revoked_device_sessions WHERE user_id=caller AND session_id=sid) THEN
    RETURN metadata||jsonb_build_object('allowed',FALSE,'reason','session_revoked');
  END IF;
  IF p_device_fingerprint IS NULL OR length(trim(p_device_fingerprint))<16
    OR length(p_device_fingerprint)>256 OR p_platform IS NULL OR p_platform NOT IN ('web','ios','android')
    THEN RAISE EXCEPTION 'Invalid browser identity'; END IF;
  SELECT * INTO existing FROM public.user_devices WHERE user_id=caller AND device_fingerprint=p_device_fingerprint;
  SELECT count(*) INTO saved_count FROM public.user_devices WHERE user_id=caller AND revoked_at IS NULL;
  IF NOT (existing.id IS NOT NULL AND existing.revoked_at IS NULL) AND saved_count>=2 THEN
    RETURN metadata||jsonb_build_object('allowed',FALSE,'active_device_count',saved_count,'reason','saved_browser_limit');
  END IF;
  INSERT INTO public.user_devices(user_id,device_fingerprint,session_id,platform,device_name,last_seen_at,lease_expires_at)
  VALUES(caller,p_device_fingerprint,sid,p_platform,left(p_device_name,120),checked_at,NULL)
  ON CONFLICT(user_id,device_fingerprint) DO UPDATE SET session_id=EXCLUDED.session_id,
    platform=EXCLUDED.platform,device_name=EXCLUDED.device_name,last_seen_at=EXCLUDED.last_seen_at,
    lease_expires_at=NULL,revoked_at=NULL;
  SELECT count(*) INTO saved_count FROM public.user_devices WHERE user_id=caller AND revoked_at IS NULL;
  RETURN metadata||jsonb_build_object('allowed',TRUE,'active_device_count',saved_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.current_session_has_registered_device()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.revoked_device_sessions r WHERE r.user_id=auth.uid() AND r.session_id::TEXT=auth.jwt()->>'session_id'
  ) AND EXISTS (SELECT 1 FROM public.user_devices d WHERE d.user_id=auth.uid()
    AND d.revoked_at IS NULL AND d.session_id::TEXT=auth.jwt()->>'session_id');
$$;

-- Keep the RPC name/shape compatible with existing clients. Expiry is now null.
CREATE OR REPLACE FUNCTION public.list_active_browser_sessions()
RETURNS TABLE(id UUID,device_name TEXT,platform TEXT,last_seen_at TIMESTAMPTZ,lease_expires_at TIMESTAMPTZ,is_current BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NULLIF(auth.jwt()->>'session_id','') IS NULL OR EXISTS (
    SELECT 1 FROM public.revoked_device_sessions WHERE user_id=auth.uid() AND session_id::TEXT=auth.jwt()->>'session_id')
    THEN RAISE EXCEPTION 'Authenticated account required'; END IF;
  RETURN QUERY SELECT d.id,d.device_name,d.platform,d.last_seen_at,NULL::TIMESTAMPTZ,
    COALESCE(d.session_id::TEXT=auth.jwt()->>'session_id',FALSE)
    FROM public.user_devices d WHERE d.user_id=auth.uid() AND d.revoked_at IS NULL ORDER BY d.first_seen_at,d.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_account_devices(p_challenge UUID DEFAULT NULL)
RETURNS TABLE(id UUID,device_name TEXT,platform TEXT,last_seen_at TIMESTAMPTZ,is_current BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (CASE WHEN p_challenge IS NOT NULL THEN public.device_recovery_is_verified(p_challenge)
    ELSE public.current_session_has_registered_device() END) THEN RAISE EXCEPTION 'Verify your account or use an approved device to manage devices'; END IF;
  RETURN QUERY SELECT d.id,d.device_name,d.platform,d.last_seen_at,COALESCE(d.session_id::TEXT=auth.jwt()->>'session_id',FALSE)
    FROM public.user_devices d WHERE d.user_id=auth.uid() AND d.revoked_at IS NULL ORDER BY d.first_seen_at,d.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_device_recovery(
  p_challenge UUID,p_remove_device_ids UUID[],p_device_fingerprint TEXT,p_platform TEXT,p_device_name TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected_count INTEGER; saved_count INTEGER; result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::TEXT,0));
  IF EXISTS (SELECT 1 FROM public.device_recovery_challenges WHERE id=p_challenge AND user_id=auth.uid() AND consumed_at IS NOT NULL)
    AND public.current_session_has_registered_device() AND EXISTS (SELECT 1 FROM public.user_devices WHERE user_id=auth.uid()
      AND revoked_at IS NULL AND device_fingerprint=p_device_fingerprint AND session_id::TEXT=auth.jwt()->>'session_id')
    THEN RETURN jsonb_build_object('allowed',TRUE); END IF;
  IF NOT public.device_recovery_is_verified(p_challenge) THEN RAISE EXCEPTION 'Recovery verification expired. Start again with your email and password'; END IF;
  SELECT count(*) INTO saved_count FROM public.user_devices WHERE user_id=auth.uid() AND revoked_at IS NULL;
  SELECT count(DISTINCT value) INTO selected_count FROM unnest(p_remove_device_ids) AS value;
  IF (saved_count>0 AND selected_count=0) OR selected_count<>COALESCE(cardinality(p_remove_device_ids),0)
    THEN RAISE EXCEPTION 'Select at least one saved browser to remove'; END IF;
  IF selected_count<>(SELECT count(*) FROM public.user_devices WHERE id=ANY(p_remove_device_ids) AND user_id=auth.uid() AND revoked_at IS NULL)
    THEN RAISE EXCEPTION 'Browser list changed. Refresh and choose again'; END IF;
  UPDATE public.user_devices SET revoked_at=clock_timestamp(),session_id=NULL WHERE user_id=auth.uid() AND id=ANY(p_remove_device_ids);
  result:=public.register_user_device(p_device_fingerprint,p_platform,p_device_name);
  IF result->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Remove another browser before continuing'; END IF;
  UPDATE public.device_recovery_challenges SET consumed_at=clock_timestamp() WHERE id=p_challenge;
  RETURN result;
END;
$$;

-- Serialize sign-out with registration/recovery. Mark even an unregistered
-- session revoked, so a late in-flight heartbeat cannot reclaim its slot.
-- Idempotent success allows retry if the original success response was lost.
CREATE OR REPLACE FUNCTION public.revoke_current_device()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE caller UUID:=auth.uid(); sid UUID:=NULLIF(auth.jwt()->>'session_id','')::UUID;
BEGIN
  IF caller IS NULL OR sid IS NULL THEN RETURN FALSE; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(caller::TEXT,0));
  INSERT INTO public.revoked_device_sessions(session_id,user_id) VALUES(sid,caller) ON CONFLICT(session_id) DO NOTHING;
  UPDATE public.user_devices SET revoked_at=clock_timestamp(),session_id=NULL
    WHERE user_id=caller AND session_id=sid AND revoked_at IS NULL;
  RETURN TRUE;
END;
$$;
-- CREATE OR REPLACE preserves the existing restricted grants and RLS policies.
COMMENT ON COLUMN public.user_devices.lease_expires_at IS 'Historical experiment only; ignored by saved-browser authorization.';
NOTIFY pgrst,'reload schema';
COMMIT;
