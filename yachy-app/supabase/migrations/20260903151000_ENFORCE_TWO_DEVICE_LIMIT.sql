-- Strict account-level limit: at most two active device fingerprints for every
-- authenticated account, regardless of platform (iOS, Android, or web).

-- Keep enforcement disabled during the app-version transition. This row has
-- no anon/authenticated grants; it is enabled manually by a database owner
-- only after the RPC-based app version has been released.
CREATE TABLE IF NOT EXISTS public.security_enforcement_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.security_enforcement_settings (singleton, enabled)
VALUES (TRUE, FALSE)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.security_enforcement_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_enforcement_settings FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.security_enforcement_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT settings.enabled FROM public.security_enforcement_settings AS settings WHERE singleton),
    FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.security_enforcement_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_enforcement_enabled() TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  session_id UUID,
  platform TEXT NOT NULL,
  device_name TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (user_id, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_active
  ON public.user_devices (user_id)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_session
  ON public.user_devices (session_id)
  WHERE session_id IS NOT NULL AND revoked_at IS NULL;

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own devices" ON public.user_devices;
CREATE POLICY "Users can read their own devices"
  ON public.user_devices
  FOR SELECT
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.register_user_device(
  p_device_fingerprint TEXT,
  p_platform TEXT,
  p_device_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing public.user_devices%ROWTYPE;
  v_active_count INTEGER;
  v_session_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_device_fingerprint IS NULL OR length(trim(p_device_fingerprint)) < 16 THEN
    RAISE EXCEPTION 'Invalid device fingerprint';
  END IF;

  BEGIN
    v_session_id := NULLIF(
      current_setting('request.jwt.claims', true)::jsonb ->> 'session_id',
      ''
    )::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_session_id := NULL;
  END;

  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated session identifier required';
  END IF;

  -- Serialize claims for this account so simultaneous logins cannot both take
  -- the same final slot.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::TEXT, 0));

  SELECT *
  INTO v_existing
  FROM public.user_devices
  WHERE user_id = v_user_id
    AND device_fingerprint = p_device_fingerprint;

  IF FOUND AND v_existing.revoked_at IS NULL THEN
    UPDATE public.user_devices
    SET last_seen_at = now(),
        session_id = v_session_id,
        platform = p_platform,
        device_name = p_device_name
    WHERE id = v_existing.id;

    SELECT count(*) INTO v_active_count
    FROM public.user_devices
    WHERE user_id = v_user_id AND revoked_at IS NULL;

    RETURN jsonb_build_object('allowed', true, 'active_device_count', v_active_count);
  END IF;

  SELECT count(*) INTO v_active_count
  FROM public.user_devices
  WHERE user_id = v_user_id AND revoked_at IS NULL;

  IF v_active_count >= 2 THEN
    RETURN jsonb_build_object('allowed', false, 'active_device_count', v_active_count);
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.user_devices
    SET revoked_at = NULL,
        session_id = v_session_id,
        last_seen_at = now(),
        platform = p_platform,
        device_name = p_device_name
    WHERE id = v_existing.id;
  ELSE
    INSERT INTO public.user_devices (
      user_id,
      device_fingerprint,
      session_id,
      platform,
      device_name
    ) VALUES (
      v_user_id,
      p_device_fingerprint,
      v_session_id,
      p_platform,
      p_device_name
    );
  END IF;

  RETURN jsonb_build_object('allowed', true, 'active_device_count', v_active_count + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.register_user_device(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_user_device(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_session_has_device_access()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT public.security_enforcement_enabled()
    OR EXISTS (
      SELECT 1
      FROM public.user_devices AS device
      WHERE device.user_id = auth.uid()
        AND device.revoked_at IS NULL
        AND device.session_id::TEXT =
          current_setting('request.jwt.claims', true)::jsonb ->> 'session_id'
    );
$$;

REVOKE ALL ON FUNCTION public.current_session_has_device_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_session_has_device_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_current_device()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id TEXT :=
    current_setting('request.jwt.claims', true)::jsonb ->> 'session_id';
BEGIN
  IF auth.uid() IS NULL OR v_session_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.user_devices
  SET revoked_at = now(),
      session_id = NULL,
      last_seen_at = now()
  WHERE user_id = auth.uid()
    AND revoked_at IS NULL
    AND session_id::TEXT = v_session_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_current_device() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_current_device() TO authenticated;

COMMENT ON TABLE public.user_devices IS
  'Hashed device installations registered to an account. Two active devices maximum.';
