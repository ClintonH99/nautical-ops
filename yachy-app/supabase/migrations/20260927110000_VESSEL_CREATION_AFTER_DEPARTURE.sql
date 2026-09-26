-- A shared-vessel departure, not signup role or client input, unlocks creation.
ALTER TABLE public.users ADD COLUMN vessel_creation_unlocked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.guard_vessel_creation_unlock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.vessel_creation_unlocked := FALSE;
  ELSE
    IF NEW.vessel_creation_unlocked IS DISTINCT FROM OLD.vessel_creation_unlocked
      AND current_setting('nautical_ops.trusted_user_change', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Vessel creation eligibility is assigned by the server';
    END IF;
    -- Joining/creating a shared vessel consumes the independent-account permission.
    IF NEW.vessel_id IS DISTINCT FROM OLD.vessel_id AND EXISTS (
      SELECT 1 FROM public.vessels WHERE id = NEW.vessel_id AND is_solo = FALSE
    ) THEN
      NEW.vessel_creation_unlocked := FALSE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_vessel_creation_unlock_trigger
BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW
EXECUTE FUNCTION public.guard_vessel_creation_unlock();
REVOKE ALL ON FUNCTION public.guard_vessel_creation_unlock() FROM PUBLIC, anon, authenticated;

-- Internal transition only. Callers authenticate/authorize and lock membership.
-- No old-vessel records or personal Sea Miles are moved or deleted.
CREATE OR REPLACE FUNCTION public.reset_departed_vessel_user(p_user_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  workspace_id UUID;
  previous_trust TEXT := current_setting('nautical_ops.trusted_user_change', true);
BEGIN
  INSERT INTO public.vessels (name, invite_code, invite_expiry, is_solo)
  VALUES ('Crew Account', public.generate_vessel_invite_code(), now() + INTERVAL '1 year', TRUE)
  RETURNING id INTO workspace_id;
  PERFORM set_config('nautical_ops.trusted_user_change', 'on', true);
  UPDATE public.users SET vessel_id = workspace_id, role = 'CREW',
    rotation_group_id = NULL, department_2 = NULL, contract_type = 'permanent',
    paused = FALSE, vessel_joined_at = now(), vessel_creation_unlocked = TRUE, updated_at = now()
  WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found'; END IF;
  PERFORM set_config('nautical_ops.trusted_user_change', COALESCE(previous_trust, 'off'), true);
  RETURN workspace_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reset_departed_vessel_user(UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remove_current_vessel_crew_member(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor_id UUID := auth.uid(); actor_vessel UUID; target_vessel UUID;
BEGIN
  IF actor_id IS NULL OR NOT public.current_session_has_device_access() THEN
    RAISE EXCEPTION 'This device is not authorized for the account';
  END IF;
  IF p_user_id = actor_id THEN RAISE EXCEPTION 'Use Leave Vessel to leave your own vessel'; END IF;
  PERFORM 1 FROM public.users WHERE id IN (actor_id, p_user_id) ORDER BY id FOR UPDATE;
  SELECT vessel_id INTO actor_vessel FROM public.users WHERE id = actor_id AND role = 'CAPTAIN_MOV';
  IF actor_vessel IS NULL THEN RAISE EXCEPTION 'Only the Captain/MOV can remove crew members'; END IF;
  SELECT vessel_id INTO target_vessel FROM public.users WHERE id = p_user_id;
  IF target_vessel IS DISTINCT FROM actor_vessel THEN RAISE EXCEPTION 'Crew member is not part of your vessel'; END IF;
  PERFORM 1 FROM public.vessels WHERE id = actor_vessel AND is_solo = FALSE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shared vessel required'; END IF;
  PERFORM public.reset_departed_vessel_user(p_user_id);
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.remove_current_vessel_crew_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_current_vessel_crew_member(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_leave_current_vessel(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE profile public.users%ROWTYPE; old_vessel public.vessels%ROWTYPE; workspace_id UUID;
BEGIN
  SELECT * INTO profile FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR profile.vessel_id IS NULL THEN RAISE EXCEPTION 'You are not currently part of a vessel'; END IF;
  SELECT * INTO old_vessel FROM public.vessels WHERE id = profile.vessel_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current vessel not found'; END IF;
  IF old_vessel.is_solo THEN RAISE EXCEPTION 'You already have your own private account - there is nothing to leave.'; END IF;
  IF profile.role = 'CAPTAIN_MOV' AND NOT EXISTS (
    SELECT 1 FROM public.users WHERE vessel_id = profile.vessel_id AND role = 'CAPTAIN_MOV' AND id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'You are the only Captain/MOV on this vessel. Promote another crew member to Captain/MOV in Crew Management before leaving.';
  END IF;
  workspace_id := public.reset_departed_vessel_user(p_user_id);
  RETURN jsonb_build_object('success', TRUE, 'vessel_id', workspace_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_leave_current_vessel(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_leave_current_vessel(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.create_captain_vessel(p_name TEXT, p_management_company_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  profile public.users%ROWTYPE; created_vessel public.vessels%ROWTYPE;
  previous_trust TEXT := current_setting('nautical_ops.trusted_user_change', true);
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_session_has_device_access() THEN
    RAISE EXCEPTION 'This device is not authorized for the account';
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN RAISE EXCEPTION 'Vessel name is required'; END IF;
  SELECT * INTO profile FROM public.users WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found'; END IF;
  IF profile.vessel_id IS NOT NULL THEN
    PERFORM 1 FROM public.vessels WHERE id = profile.vessel_id AND is_solo = TRUE FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Leave your current vessel before creating a new vessel'; END IF;
    IF NOT profile.vessel_creation_unlocked THEN
      RAISE EXCEPTION 'Vessel creation is available after leaving or being removed from a shared vessel';
    END IF;
  ELSIF profile.role <> 'CAPTAIN_MOV' AND NOT profile.vessel_creation_unlocked THEN
    RAISE EXCEPTION 'Vessel creation is available to new Captain accounts or after a shared-vessel departure';
  END IF;
  INSERT INTO public.vessels (name, management_company_id, invite_code, invite_expiry, is_solo)
  VALUES (trim(p_name), p_management_company_id, public.generate_vessel_invite_code(), now() + INTERVAL '1 year', FALSE)
  RETURNING * INTO created_vessel;
  PERFORM set_config('nautical_ops.trusted_user_change', 'on', true);
  UPDATE public.users SET vessel_id = created_vessel.id, role = 'CAPTAIN_MOV',
    vessel_creation_unlocked = FALSE, vessel_joined_at = now(), updated_at = now()
  WHERE id = auth.uid();
  PERFORM set_config('nautical_ops.trusted_user_change', COALESCE(previous_trust, 'off'), true);
  -- Match existing join-vessel cleanup: only the caller's empty private workspace.
  DELETE FROM public.vessels WHERE id = profile.vessel_id AND is_solo = TRUE
    AND NOT EXISTS (SELECT 1 FROM public.users WHERE vessel_id = profile.vessel_id);
  RETURN to_jsonb(created_vessel);
END;
$$;
REVOKE ALL ON FUNCTION public.create_captain_vessel(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_captain_vessel(TEXT, UUID) TO authenticated;
