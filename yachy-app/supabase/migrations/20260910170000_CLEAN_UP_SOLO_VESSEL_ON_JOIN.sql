-- Remove a Crew member's now-empty private workspace after they successfully
-- join a real vessel. This is part of the same database transaction as the
-- transfer, so any failure rolls back both the move and the cleanup.

CREATE OR REPLACE FUNCTION public.join_current_user_to_vessel(p_invite_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_profile public.users%ROWTYPE;
  target_vessel public.vessels%ROWTYPE;
  previous_vessel_id UUID;
  validated JSONB;
  other_captains INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_session_has_device_access() THEN
    RAISE EXCEPTION 'This device is not authorized for the account';
  END IF;

  SELECT * INTO current_profile FROM public.users WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found'; END IF;
  previous_vessel_id := current_profile.vessel_id;

  -- Lock the invite row before re-validating the crew count. Concurrent joins
  -- cannot both claim the final plan slot or reuse the same one-time code.
  SELECT * INTO target_vessel
  FROM public.vessels
  WHERE invite_code = upper(trim(p_invite_code))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invite code'; END IF;

  validated := public.validate_vessel_invite_code(p_invite_code);
  IF target_vessel.id <> (validated ->> 'id')::UUID THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  IF previous_vessel_id = target_vessel.id THEN
    RETURN jsonb_build_object('id', target_vessel.id, 'name', target_vessel.name);
  END IF;

  IF current_profile.role = 'CAPTAIN_MOV' AND previous_vessel_id IS NOT NULL THEN
    SELECT count(*) INTO other_captains
    FROM public.users
    WHERE vessel_id = previous_vessel_id
      AND role = 'CAPTAIN_MOV'
      AND id <> auth.uid();
    IF other_captains < 1 THEN
      RAISE EXCEPTION 'You are the only Captain/MOV on your current vessel. Promote another crew member before joining a new vessel.';
    END IF;
  END IF;

  PERFORM set_config('nautical_ops.trusted_user_change', 'on', true);
  UPDATE public.users
  SET vessel_id = target_vessel.id,
      role = 'CREW',
      rotation_group_id = NULL,
      paused = FALSE,
      vessel_joined_at = now(),
      updated_at = now()
  WHERE id = auth.uid();
  PERFORM set_config('nautical_ops.trusted_user_change', 'off', true);

  -- Delete only the caller's previous private workspace, and only if the move
  -- left it empty. Shared/real vessels and occupied workspaces cannot match.
  IF previous_vessel_id IS NOT NULL THEN
    DELETE FROM public.vessels AS previous_vessel
    WHERE previous_vessel.id = previous_vessel_id
      AND previous_vessel.is_solo = TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM public.users AS remaining_member
        WHERE remaining_member.vessel_id = previous_vessel.id
      );
  END IF;

  UPDATE public.vessels
  SET invite_code = public.generate_vessel_invite_code(),
      invite_expiry = now() + INTERVAL '1 year',
      updated_at = now()
  WHERE id = target_vessel.id;

  RETURN jsonb_build_object('id', target_vessel.id, 'name', target_vessel.name);
END;
$$;

REVOKE ALL ON FUNCTION public.join_current_user_to_vessel(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_current_user_to_vessel(TEXT) TO authenticated;
