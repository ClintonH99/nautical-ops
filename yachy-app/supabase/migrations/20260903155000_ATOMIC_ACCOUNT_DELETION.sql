-- Prepare an account for deletion in one database transaction. Authentication
-- deletion remains an Admin API call, but this RPC is safely retryable when a
-- prior attempt removed the profile and the Auth deletion failed transiently.

CREATE OR REPLACE FUNCTION public.admin_prepare_account_deletion(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_profile public.users%ROWTYPE;
  current_vessel public.vessels%ROWTYPE;
  subscription_row public.vessel_subscriptions%ROWTYPE;
  other_user_count INTEGER := 0;
  other_captain_count INTEGER := 0;
  cleanup_vessel BOOLEAN := FALSE;
  cleanup_vessel_id UUID := NULL;
  cancellation_provider TEXT := NULL;
BEGIN
  SELECT * INTO current_profile
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  -- A previous attempt may already have committed the database phase. Returning
  -- success lets the Edge Function retry deletion of the Auth user.
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'profile_already_removed', true,
      'deleted_vessel_id', NULL,
      'cancellation_provider', NULL
    );
  END IF;

  IF current_profile.vessel_id IS NOT NULL THEN
    SELECT * INTO current_vessel
    FROM public.vessels
    WHERE id = current_profile.vessel_id
    FOR UPDATE;

    IF FOUND THEN
      PERFORM 1 FROM public.users
      WHERE vessel_id = current_profile.vessel_id
      FOR UPDATE;

      SELECT
        count(*) FILTER (WHERE id <> p_user_id),
        count(*) FILTER (WHERE id <> p_user_id AND role = 'CAPTAIN_MOV')
      INTO other_user_count, other_captain_count
      FROM public.users
      WHERE vessel_id = current_profile.vessel_id;

      IF current_profile.role = 'CAPTAIN_MOV'
         AND other_user_count > 0
         AND other_captain_count = 0 THEN
        RAISE EXCEPTION 'You are the only Captain/MOV on this vessel. Promote another crew member to Captain/MOV in Crew Management before deleting your account.';
      END IF;

      cleanup_vessel := other_user_count = 0;
      IF cleanup_vessel THEN
        cleanup_vessel_id := current_profile.vessel_id;

        SELECT * INTO subscription_row
        FROM public.vessel_subscriptions
        WHERE vessel_id = cleanup_vessel_id
        ORDER BY current_period_end DESC
        LIMIT 1;

        IF FOUND AND subscription_row.paddle_subscription_id IS NOT NULL THEN
          RAISE EXCEPTION 'This account has a legacy billing record. Contact support@nautical-ops.com so billing can be cancelled safely before deleting the account.';
        END IF;
        IF FOUND AND subscription_row.payment_provider IN ('apple', 'google') THEN
          cancellation_provider := subscription_row.payment_provider;
        END IF;
      END IF;
    END IF;
  END IF;

  DELETE FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Could not remove account profile'; END IF;

  IF cleanup_vessel AND cleanup_vessel_id IS NOT NULL THEN
    DELETE FROM public.vessels WHERE id = cleanup_vessel_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Could not remove private vessel'; END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'profile_already_removed', false,
    'deleted_vessel_id', cleanup_vessel_id,
    'cancellation_provider', cancellation_provider
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_prepare_account_deletion(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_prepare_account_deletion(UUID) TO service_role;
