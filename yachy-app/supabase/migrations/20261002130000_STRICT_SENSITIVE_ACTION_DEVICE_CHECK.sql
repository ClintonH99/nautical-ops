-- Sensitive service-role actions need a caller-session check even while the
-- broader browser/device rollout remains disabled. No subscription check here:
-- a registered crew session must still be able to leave an unpaid vessel.
CREATE OR REPLACE FUNCTION public.current_session_has_registered_device()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_devices AS device
    WHERE device.user_id = auth.uid()
      AND device.revoked_at IS NULL
      AND device.session_id::TEXT = auth.jwt() ->> 'session_id'
  );
$$;

REVOKE ALL ON FUNCTION public.current_session_has_registered_device() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_session_has_registered_device() TO authenticated;

COMMENT ON FUNCTION public.current_session_has_registered_device() IS
  'Strict caller-session approval for sensitive actions; independent of device rollout and subscription status.';
