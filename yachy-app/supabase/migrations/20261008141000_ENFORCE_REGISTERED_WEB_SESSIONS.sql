-- The released web app registers sessions before vessel operations and exposes
-- device recovery outside the vessel/subscription gate. Do not allow the old
-- rollout switch to bypass this security boundary again.
BEGIN;

CREATE TABLE IF NOT EXISTS public.revoked_device_sessions (
  session_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.revoked_device_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.revoked_device_sessions FROM PUBLIC, anon, authenticated;

-- A removed/replaced session must not silently reclaim a free device slot on
-- its next heartbeat. A fresh authenticated session can still register/recover.
CREATE OR REPLACE FUNCTION public.remember_revoked_device_session()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.session_id IS NOT NULL AND (
    TG_OP = 'DELETE' OR NEW.revoked_at IS NOT NULL OR
    NEW.session_id IS DISTINCT FROM OLD.session_id
  ) AND EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
    INSERT INTO public.revoked_device_sessions(session_id, user_id)
    VALUES (OLD.session_id, OLD.user_id) ON CONFLICT (session_id) DO NOTHING;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.remember_revoked_device_session() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS remember_revoked_device_session ON public.user_devices;
CREATE TRIGGER remember_revoked_device_session BEFORE UPDATE OR DELETE ON public.user_devices
  FOR EACH ROW EXECUTE FUNCTION public.remember_revoked_device_session();

-- Preserve the existing serialized two-slot registration implementation behind
-- a private function. Reapplication must not rename the public wrapper again.
DO $$ BEGIN
  IF to_regprocedure('public.register_user_device_internal(text,text,text)') IS NULL THEN
    ALTER FUNCTION public.register_user_device(TEXT, TEXT, TEXT) RENAME TO register_user_device_internal;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.register_user_device_internal(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.register_user_device(
  p_device_fingerprint TEXT, p_platform TEXT, p_device_name TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller UUID := auth.uid();
  session_identifier TEXT := auth.jwt()->>'session_id';
BEGIN
  IF caller IS NULL OR session_identifier IS NULL OR session_identifier = '' THEN
    RAISE EXCEPTION 'Authenticated session identifier required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(caller::TEXT, 0));
  IF EXISTS (SELECT 1 FROM public.revoked_device_sessions
    WHERE user_id = caller AND session_id::TEXT = session_identifier) THEN
    RETURN jsonb_build_object('allowed', FALSE, 'reason', 'session_revoked');
  END IF;
  RETURN public.register_user_device_internal(p_device_fingerprint, p_platform, p_device_name);
END;
$$;
REVOKE ALL ON FUNCTION public.register_user_device(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_user_device(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_session_has_device_access()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.current_session_has_registered_device();
$$;
REVOKE ALL ON FUNCTION public.current_session_has_device_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_session_has_device_access() TO authenticated;

DROP POLICY IF EXISTS "Legacy app can create vessels before enforcement activation" ON public.vessels;
DROP POLICY IF EXISTS "Users create only their own unassigned profile" ON public.users;
CREATE POLICY "Users create only their own unassigned profile" ON public.users
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid() AND vessel_id IS NULL);

UPDATE public.security_enforcement_settings SET enabled = TRUE, updated_at = now() WHERE singleton;
COMMENT ON FUNCTION public.current_session_has_device_access() IS
  'Unconditional registered-session guard; legacy rollout settings cannot grant access.';
NOTIFY pgrst, 'reload schema';
COMMIT;
