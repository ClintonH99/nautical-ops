-- Watch Keeper designation is no longer part of Crew Management or the Hours
-- of Rest report. Rotation status is now assigned explicitly by the Captain.

DROP TABLE IF EXISTS public.watch_keepers;

CREATE OR REPLACE FUNCTION public.assign_current_vessel_crew_rotation(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_vessel_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_session_has_device_access() THEN
    RAISE EXCEPTION 'This device is not authorized for the account';
  END IF;

  SELECT vessel_id
  INTO actor_vessel_id
  FROM public.users
  WHERE id = auth.uid()
    AND role = 'CAPTAIN_MOV';

  IF actor_vessel_id IS NULL
    OR NOT public.current_user_is_captain_of(actor_vessel_id) THEN
    RAISE EXCEPTION 'Only the Captain/MOV can assign crew rotations';
  END IF;

  PERFORM 1
  FROM public.users
  WHERE id = p_user_id
    AND vessel_id = actor_vessel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Crew member is not part of your vessel';
  END IF;

  PERFORM set_config('nautical_ops.trusted_user_change', 'on', true);
  UPDATE public.users
  SET contract_type = 'rotational',
      rotation_group_id = NULL,
      updated_at = now()
  WHERE id = p_user_id;
  PERFORM set_config('nautical_ops.trusted_user_change', 'off', true);

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_current_vessel_crew_rotation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_current_vessel_crew_rotation(UUID) TO authenticated;
