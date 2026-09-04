-- Move users between vessels atomically. The Edge Functions authenticate the
-- caller, then invoke these service-role-only RPCs. If any insert, update, or
-- delete fails, PostgreSQL rolls the entire operation back.

CREATE OR REPLACE FUNCTION public.admin_leave_current_vessel(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_profile public.users%ROWTYPE;
  current_vessel public.vessels%ROWTYPE;
  created_vessel public.vessels%ROWTYPE;
  other_captains INTEGER;
BEGIN
  SELECT * INTO current_profile
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR current_profile.vessel_id IS NULL THEN
    RAISE EXCEPTION 'You are not currently part of a vessel';
  END IF;

  SELECT * INTO current_vessel
  FROM public.vessels
  WHERE id = current_profile.vessel_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current vessel not found'; END IF;
  IF current_vessel.is_solo THEN
    RAISE EXCEPTION 'You already have your own private account - there is nothing to leave.';
  END IF;

  IF current_profile.role = 'CAPTAIN_MOV' THEN
    SELECT count(*) INTO other_captains
    FROM public.users
    WHERE vessel_id = current_profile.vessel_id
      AND role = 'CAPTAIN_MOV'
      AND id <> p_user_id;
    IF other_captains < 1 THEN
      RAISE EXCEPTION 'You are the only Captain/MOV on this vessel. Promote another crew member to Captain/MOV in Crew Management before leaving.';
    END IF;
  END IF;

  INSERT INTO public.vessels (name, invite_code, invite_expiry, is_solo)
  VALUES ('Crew Account', public.generate_vessel_invite_code(), now() + INTERVAL '1 year', TRUE)
  RETURNING * INTO created_vessel;

  PERFORM set_config('nautical_ops.trusted_user_change', 'on', true);
  UPDATE public.users
  SET vessel_id = created_vessel.id,
      role = 'CREW',
      vessel_joined_at = now(),
      updated_at = now()
  WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Could not move account to a private vessel'; END IF;
  PERFORM set_config('nautical_ops.trusted_user_change', 'off', true);

  RETURN jsonb_build_object('success', true, 'vessel_id', created_vessel.id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_leave_current_vessel(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_leave_current_vessel(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_delete_current_vessel(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_profile public.users%ROWTYPE;
  subscription_row public.vessel_subscriptions%ROWTYPE;
  crew_member public.users%ROWTYPE;
  created_vessel public.vessels%ROWTYPE;
  deleted_vessel_id UUID;
  moved_user_count INTEGER := 0;
  cancellation_provider TEXT := NULL;
BEGIN
  SELECT * INTO current_profile
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR current_profile.vessel_id IS NULL OR current_profile.role <> 'CAPTAIN_MOV' THEN
    RAISE EXCEPTION 'Only the Captain/MOV can delete a vessel';
  END IF;
  deleted_vessel_id := current_profile.vessel_id;

  PERFORM 1 FROM public.vessels WHERE id = deleted_vessel_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vessel not found'; END IF;

  SELECT * INTO subscription_row
  FROM public.vessel_subscriptions
  WHERE vessel_id = deleted_vessel_id
  ORDER BY current_period_end DESC
  LIMIT 1;

  IF FOUND AND subscription_row.paddle_subscription_id IS NOT NULL THEN
    RAISE EXCEPTION 'This vessel has a legacy billing record. Contact support@nautical-ops.com so billing can be cancelled safely before the vessel is deleted.';
  END IF;
  IF FOUND AND subscription_row.payment_provider IN ('apple', 'google') THEN
    cancellation_provider := subscription_row.payment_provider;
  END IF;

  PERFORM 1 FROM public.users WHERE vessel_id = deleted_vessel_id FOR UPDATE;
  PERFORM set_config('nautical_ops.trusted_user_change', 'on', true);
  FOR crew_member IN
    SELECT * FROM public.users WHERE vessel_id = deleted_vessel_id ORDER BY id
  LOOP
    INSERT INTO public.vessels (name, invite_code, invite_expiry, is_solo)
    VALUES ('Crew Account', public.generate_vessel_invite_code(), now() + INTERVAL '1 year', TRUE)
    RETURNING * INTO created_vessel;

    UPDATE public.users
    SET vessel_id = created_vessel.id,
        role = 'CREW',
        vessel_joined_at = now(),
        updated_at = now()
    WHERE id = crew_member.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Could not move every account to a private vessel'; END IF;
    moved_user_count := moved_user_count + 1;
  END LOOP;
  PERFORM set_config('nautical_ops.trusted_user_change', 'off', true);

  DELETE FROM public.vessels WHERE id = deleted_vessel_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Could not delete vessel'; END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_vessel_id', deleted_vessel_id,
    'moved_user_count', moved_user_count,
    'cancellation_provider', cancellation_provider
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_current_vessel(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_current_vessel(UUID) TO service_role;
