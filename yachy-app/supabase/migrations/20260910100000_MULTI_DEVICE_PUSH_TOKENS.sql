-- Store push notification tokens per registered installation so both allowed
-- devices receive notifications without one device replacing the other.

ALTER TABLE public.user_devices
  ADD COLUMN IF NOT EXISTS expo_push_token TEXT,
  ADD COLUMN IF NOT EXISTS push_token_updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_expo_push_token
  ON public.user_devices (expo_push_token)
  WHERE expo_push_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_current_device_push_token(
  p_device_fingerprint TEXT,
  p_expo_push_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token TEXT := trim(p_expo_push_token);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_device_fingerprint IS NULL OR length(trim(p_device_fingerprint)) < 16 THEN
    RAISE EXCEPTION 'Invalid device fingerprint';
  END IF;

  IF v_token IS NULL
    OR length(v_token) > 512
    OR (
      v_token NOT LIKE 'ExponentPushToken[%]'
      AND v_token NOT LIKE 'ExpoPushToken[%]'
    )
  THEN
    RAISE EXCEPTION 'Invalid Expo push token';
  END IF;

  UPDATE public.user_devices
  SET expo_push_token = v_token,
      push_token_updated_at = now(),
      last_seen_at = now()
  WHERE user_id = auth.uid()
    AND device_fingerprint = p_device_fingerprint
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current device is not registered';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.set_current_device_push_token(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_current_device_push_token(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_current_device_push_token(
  p_device_fingerprint TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.user_devices
  SET expo_push_token = NULL,
      push_token_updated_at = now(),
      last_seen_at = now()
  WHERE user_id = auth.uid()
    AND device_fingerprint = p_device_fingerprint
    AND revoked_at IS NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_current_device_push_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_current_device_push_token(TEXT) TO authenticated;

-- Signing out releases this installation and its notification token only.
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
      expo_push_token = NULL,
      push_token_updated_at = now(),
      last_seen_at = now()
  WHERE user_id = auth.uid()
    AND revoked_at IS NULL
    AND session_id::TEXT = v_session_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_current_device() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_current_device() TO authenticated;

COMMENT ON COLUMN public.user_devices.expo_push_token IS
  'Expo push token for this registered installation. Cleared when the device is revoked.';
