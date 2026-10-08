-- Close the legacy disclosure independently of the device rollout switch.
-- Signup already calls validate_vessel_invite_code(text), which returns only
-- the vessel ID/name for a supplied valid code. It does not need table access.
BEGIN;

ALTER TABLE public.vessels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vessel_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Legacy app validates invites before enforcement activation" ON public.vessels;
DROP POLICY IF EXISTS "Legacy app reads own subscription before enforcement activation" ON public.vessel_subscriptions;
REVOKE ALL ON public.vessels, public.vessel_subscriptions FROM anon, PUBLIC;

-- Defense in depth if a later migration accidentally restores a table grant.
DROP POLICY IF EXISTS "Anonymous callers cannot access vessels" ON public.vessels;
CREATE POLICY "Anonymous callers cannot access vessels"
  ON public.vessels AS RESTRICTIVE FOR ALL TO anon USING (FALSE) WITH CHECK (FALSE);
DROP POLICY IF EXISTS "Anonymous callers cannot access subscriptions" ON public.vessel_subscriptions;
CREATE POLICY "Anonymous callers cannot access subscriptions"
  ON public.vessel_subscriptions AS RESTRICTIVE FOR ALL TO anon USING (FALSE) WITH CHECK (FALSE);

-- Clients read the scoped entitlement RPC, never provider/customer fields.
REVOKE ALL ON public.vessel_subscriptions FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_vessel_subscription_entitlement(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
