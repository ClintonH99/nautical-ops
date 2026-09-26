-- Removal cannot return the detached users row through the caller's SELECT RLS.
-- Validate the Captain and current vessel on the server, then return confirmation
-- only. Do not delete the account, personal records, or the vessel's history.
CREATE OR REPLACE FUNCTION public.remove_current_vessel_crew_member(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_vessel_id UUID;
  target_vessel_id UUID;
  previous_trusted_change TEXT := current_setting('nautical_ops.trusted_user_change', true);
BEGIN
  IF actor_id IS NULL OR NOT public.current_session_has_device_access() THEN
    RAISE EXCEPTION 'This device is not authorized for the account';
  END IF;
  IF p_user_id = actor_id THEN
    RAISE EXCEPTION 'Use Leave Vessel to leave your own vessel';
  END IF;

  -- Lock both profiles in a consistent order. A concurrent move/removal must
  -- not let a former Captain remove crew after their own membership has ended.
  PERFORM 1 FROM public.users
  WHERE id IN (actor_id, p_user_id)
  ORDER BY id FOR UPDATE;

  SELECT vessel_id INTO actor_vessel_id FROM public.users
  WHERE id = actor_id AND role = 'CAPTAIN_MOV';
  IF actor_vessel_id IS NULL THEN
    RAISE EXCEPTION 'Only the Captain/MOV can remove crew members';
  END IF;

  SELECT vessel_id INTO target_vessel_id FROM public.users WHERE id = p_user_id;
  IF target_vessel_id IS NULL OR target_vessel_id IS DISTINCT FROM actor_vessel_id THEN
    RAISE EXCEPTION 'Crew member is not part of your vessel';
  END IF;

  -- Removal is not gated by crew limits, department, target role, or billing.
  -- Session authorization and current Captain/vessel ownership remain required.
  PERFORM set_config('nautical_ops.trusted_user_change', 'on', true);
  UPDATE public.users
  SET vessel_id = NULL,
      vessel_joined_at = NULL,
      rotation_group_id = NULL,
      updated_at = now()
  WHERE id = p_user_id AND vessel_id = actor_vessel_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Crew member is not part of your vessel'; END IF;
  PERFORM set_config('nautical_ops.trusted_user_change', COALESCE(previous_trusted_change, 'off'), true);

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_current_vessel_crew_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_current_vessel_crew_member(UUID) TO authenticated;
