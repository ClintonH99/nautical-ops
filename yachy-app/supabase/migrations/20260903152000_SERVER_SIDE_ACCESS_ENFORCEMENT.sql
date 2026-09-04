-- Server-side security boundary for vessel access.
-- IMPORTANT ROLLOUT: this migration may be deployed before the new app because
-- strict enforcement starts disabled. Release the RPC-based app, require that
-- version, and only then enable public.security_enforcement_settings.

CREATE OR REPLACE FUNCTION public.vessel_subscription_allows_access(target_vessel_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  subscription_row public.vessel_subscriptions%ROWTYPE;
  paid_through TIMESTAMPTZ;
  grace_through TIMESTAMPTZ;
BEGIN
  SELECT *
  INTO subscription_row
  FROM public.vessel_subscriptions
  WHERE vessel_id = target_vessel_id
  ORDER BY current_period_end DESC
  LIMIT 1;

  -- The overdue-payment restriction applies only to a vessel that previously
  -- had a paid subscription. A missing row is not proof of failed payment.
  IF NOT FOUND THEN
    RETURN TRUE;
  END IF;

  IF subscription_row.status = 'revoked' THEN
    RETURN FALSE;
  END IF;

  paid_through := subscription_row.current_period_end;
  IF paid_through > now() AND subscription_row.status <> 'past_due' THEN
    RETURN TRUE;
  END IF;

  -- An expired row still marked active/trialing may simply be stale because a
  -- provider callback is delayed. Fail open until the provider confirms loss
  -- of entitlement; connectivity uncertainty must never cause a lockout.
  IF subscription_row.status IN ('active', 'trialing') THEN
    RETURN TRUE;
  END IF;

  IF subscription_row.status = 'past_due' THEN
    grace_through := COALESCE(
      subscription_row.grace_period_end,
      paid_through + INTERVAL '16 days'
    );
    RETURN grace_through > now();
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.vessel_subscription_allows_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vessel_subscription_allows_access(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_access_vessel(target_vessel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.current_session_has_device_access()
    AND public.vessel_subscription_allows_access(target_vessel_id)
    AND EXISTS (
      SELECT 1
      FROM public.users AS current_user_row
      WHERE current_user_row.id = auth.uid()
        AND current_user_row.vessel_id = target_vessel_id
    );
$$;

REVOKE ALL ON FUNCTION public.current_user_can_access_vessel(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_vessel(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_manage_vessel(target_vessel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.current_user_can_access_vessel(target_vessel_id)
    AND EXISTS (
      SELECT 1
      FROM public.users AS current_user_row
      WHERE current_user_row.id = auth.uid()
        AND current_user_row.vessel_id = target_vessel_id
        AND current_user_row.role IN ('HOD', 'CAPTAIN_MOV')
    );
$$;

REVOKE ALL ON FUNCTION public.current_user_can_manage_vessel(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_vessel(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_is_captain_of(target_vessel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.current_user_can_access_vessel(target_vessel_id)
    AND EXISTS (
      SELECT 1
      FROM public.users AS current_user_row
      WHERE current_user_row.id = auth.uid()
        AND current_user_row.vessel_id = target_vessel_id
        AND current_user_row.role = 'CAPTAIN_MOV'
    );
$$;

REVOKE ALL ON FUNCTION public.current_user_is_captain_of(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_captain_of(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_captain_can_assign_profile(target_vessel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS actor
    WHERE actor.id = auth.uid()
      AND actor.role = 'CAPTAIN_MOV'
      AND public.current_user_can_access_vessel(actor.vessel_id)
      AND (target_vessel_id IS NULL OR target_vessel_id = actor.vessel_id)
  );
$$;

REVOKE ALL ON FUNCTION public.current_captain_can_assign_profile(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_captain_can_assign_profile(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_vessel_hod_or_captain(target_vessel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.current_user_can_manage_vessel(target_vessel_id);
$$;

REVOKE ALL ON FUNCTION public.is_vessel_hod_or_captain(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_vessel_hod_or_captain(UUID) TO authenticated;

-- Direct clients may edit ordinary profile fields, but may never change their
-- own authorization or vessel membership fields. Trusted RPCs/Edge Functions
-- set a transaction-local flag before making a validated change.
CREATE OR REPLACE FUNCTION public.protect_user_security_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_role TEXT;
  actor_vessel_id UUID;
  trusted_change BOOLEAN :=
    current_setting('nautical_ops.trusted_user_change', true) = 'on';
BEGIN
  IF auth.uid() IS NULL OR trusted_change OR NOT public.security_enforcement_enabled() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.id <> auth.uid()
      OR NEW.vessel_id IS NOT NULL
      OR NEW.role NOT IN ('CREW', 'CAPTAIN_MOV') THEN
      RAISE EXCEPTION 'User profile security fields must be assigned by the server';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'User identity fields cannot be changed through the profile API';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
    AND NEW.role NOT IN ('CREW', 'HOD', 'CAPTAIN_MOV') THEN
    RAISE EXCEPTION 'Invalid vessel role';
  END IF;

  IF NEW.role IS NOT DISTINCT FROM OLD.role
    AND NEW.vessel_id IS NOT DISTINCT FROM OLD.vessel_id
    AND NEW.contract_type IS NOT DISTINCT FROM OLD.contract_type
    AND NEW.rotation_group_id IS NOT DISTINCT FROM OLD.rotation_group_id THEN
    RETURN NEW;
  END IF;

  IF NEW.id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role or vessel membership';
  END IF;

  SELECT role, vessel_id
  INTO actor_role, actor_vessel_id
  FROM public.users
  WHERE id = auth.uid();

  IF actor_role <> 'CAPTAIN_MOV'
    OR actor_vessel_id IS NULL
    OR OLD.vessel_id <> actor_vessel_id
    OR NOT public.current_user_can_access_vessel(actor_vessel_id) THEN
    RAISE EXCEPTION 'Only the Captain/MOV can change vessel membership fields';
  END IF;

  IF NEW.rotation_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.rotation_groups AS rotation_group
    WHERE rotation_group.id = NEW.rotation_group_id
      AND rotation_group.vessel_id = actor_vessel_id
  ) THEN
    RAISE EXCEPTION 'Rotation group belongs to a different vessel';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_user_security_fields_trigger ON public.users;
CREATE TRIGGER protect_user_security_fields_trigger
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_user_security_fields();

-- Vessel assignment is security-sensitive. These RPCs are the only client
-- entry points that may create a vessel or move the current user to one.
CREATE OR REPLACE FUNCTION public.generate_vessel_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  candidate TEXT;
  alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
BEGIN
  FOR attempt IN 1..20 LOOP
    candidate := '';
    FOR character_index IN 1..8 LOOP
      candidate := candidate || substr(
        alphabet,
        floor(random() * length(alphabet))::INTEGER + 1,
        1
      );
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.vessels WHERE invite_code = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'Could not generate a unique invite code';
END;
$$;

REVOKE ALL ON FUNCTION public.generate_vessel_invite_code() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.regenerate_current_vessel_invite_code(p_vessel_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_code TEXT;
BEGIN
  IF NOT public.current_user_is_captain_of(p_vessel_id) THEN
    RAISE EXCEPTION 'Only the Captain/MOV can regenerate an invite code';
  END IF;

  new_code := public.generate_vessel_invite_code();
  UPDATE public.vessels
  SET invite_code = new_code,
      invite_expiry = now() + INTERVAL '1 year',
      updated_at = now()
  WHERE id = p_vessel_id;
  RETURN new_code;
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_current_vessel_invite_code(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_current_vessel_invite_code(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_vessel_invite_code(p_invite_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_vessel public.vessels%ROWTYPE;
  subscription_row public.vessel_subscriptions%ROWTYPE;
  member_count INTEGER;
  max_members INTEGER;
BEGIN
  SELECT * INTO target_vessel
  FROM public.vessels
  WHERE invite_code = upper(trim(p_invite_code))
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invite code'; END IF;
  IF target_vessel.invite_expiry < now() THEN RAISE EXCEPTION 'Invite code has expired'; END IF;

  SELECT * INTO subscription_row
  FROM public.vessel_subscriptions
  WHERE vessel_id = target_vessel.id
  ORDER BY current_period_end DESC
  LIMIT 1;

  IF NOT FOUND OR NOT public.vessel_subscription_allows_access(target_vessel.id) THEN
    RAISE EXCEPTION 'This vessel does not have an active subscription. Ask the Captain to subscribe before crew can join.';
  END IF;

  max_members := CASE subscription_row.plan_tier
    WHEN '1_5' THEN 5
    WHEN '6_10' THEN 10
    WHEN '11_15' THEN 15
    WHEN '16_25' THEN 25
    WHEN '26_40' THEN 40
    ELSE NULL
  END;

  IF max_members IS NOT NULL THEN
    SELECT count(*) INTO member_count FROM public.users WHERE vessel_id = target_vessel.id;
    IF member_count >= max_members THEN
      RAISE EXCEPTION 'This vessel has reached its crew limit of %. The Captain needs to upgrade the plan to add more crew.', max_members;
    END IF;
  END IF;

  RETURN jsonb_build_object('id', target_vessel.id, 'name', target_vessel.name);
END;
$$;

REVOKE ALL ON FUNCTION public.validate_vessel_invite_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_vessel_invite_code(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_captain_vessel(
  p_name TEXT,
  p_management_company_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_profile public.users%ROWTYPE;
  created_vessel public.vessels%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_session_has_device_access() THEN
    RAISE EXCEPTION 'This device is not authorized for the account';
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN RAISE EXCEPTION 'Vessel name is required'; END IF;

  SELECT * INTO current_profile FROM public.users WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR current_profile.role <> 'CAPTAIN_MOV' THEN
    RAISE EXCEPTION 'Only a Captain/MOV account can create a vessel';
  END IF;
  IF current_profile.vessel_id IS NOT NULL THEN RAISE EXCEPTION 'This account already belongs to a vessel'; END IF;

  INSERT INTO public.vessels (name, management_company_id, invite_code, invite_expiry, is_solo)
  VALUES (trim(p_name), p_management_company_id, public.generate_vessel_invite_code(), now() + INTERVAL '1 year', FALSE)
  RETURNING * INTO created_vessel;

  PERFORM set_config('nautical_ops.trusted_user_change', 'on', true);
  UPDATE public.users
  SET vessel_id = created_vessel.id,
      role = 'CAPTAIN_MOV',
      vessel_joined_at = now(),
      updated_at = now()
  WHERE id = auth.uid();
  PERFORM set_config('nautical_ops.trusted_user_change', 'off', true);

  RETURN jsonb_build_object(
    'id', created_vessel.id,
    'name', created_vessel.name,
    'management_company_id', created_vessel.management_company_id,
    'invite_code', created_vessel.invite_code,
    'invite_expiry', created_vessel.invite_expiry,
    'created_at', created_vessel.created_at,
    'updated_at', created_vessel.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_captain_vessel(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_captain_vessel(TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_solo_vessel_for_current_user()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_profile public.users%ROWTYPE;
  created_vessel public.vessels%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_session_has_device_access() THEN
    RAISE EXCEPTION 'This device is not authorized for the account';
  END IF;

  SELECT * INTO current_profile FROM public.users WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR current_profile.role <> 'CREW' THEN RAISE EXCEPTION 'Crew profile required'; END IF;
  IF current_profile.vessel_id IS NOT NULL THEN RAISE EXCEPTION 'This account already belongs to a vessel'; END IF;

  INSERT INTO public.vessels (name, invite_code, invite_expiry, is_solo)
  VALUES ('Crew Account', public.generate_vessel_invite_code(), now() + INTERVAL '1 year', TRUE)
  RETURNING * INTO created_vessel;

  PERFORM set_config('nautical_ops.trusted_user_change', 'on', true);
  UPDATE public.users
  SET vessel_id = created_vessel.id,
      role = 'CREW',
      vessel_joined_at = now(),
      updated_at = now()
  WHERE id = auth.uid();
  PERFORM set_config('nautical_ops.trusted_user_change', 'off', true);

  RETURN jsonb_build_object('id', created_vessel.id, 'name', created_vessel.name);
END;
$$;

REVOKE ALL ON FUNCTION public.create_solo_vessel_for_current_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_solo_vessel_for_current_user() TO authenticated;

CREATE OR REPLACE FUNCTION public.join_current_user_to_vessel(p_invite_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_profile public.users%ROWTYPE;
  target_vessel public.vessels%ROWTYPE;
  validated JSONB;
  other_captains INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_session_has_device_access() THEN
    RAISE EXCEPTION 'This device is not authorized for the account';
  END IF;

  SELECT * INTO current_profile FROM public.users WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found'; END IF;

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

  IF current_profile.vessel_id = target_vessel.id THEN
    RETURN jsonb_build_object('id', target_vessel.id, 'name', target_vessel.name);
  END IF;

  IF current_profile.role = 'CAPTAIN_MOV' AND current_profile.vessel_id IS NOT NULL THEN
    SELECT count(*) INTO other_captains
    FROM public.users
    WHERE vessel_id = current_profile.vessel_id
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
      vessel_joined_at = now(),
      updated_at = now()
  WHERE id = auth.uid();
  PERFORM set_config('nautical_ops.trusted_user_change', 'off', true);

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

-- A StoreKit appAccountToken identifies a short-lived server-approved purchase
-- attempt. It is deliberately not a vessel ID chosen by the mobile client.
CREATE TABLE IF NOT EXISTS public.pending_subscription_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('apple', 'google')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '1 day',
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_subscription_purchases_lookup
  ON public.pending_subscription_purchases (id, provider)
  WHERE consumed_at IS NULL;

ALTER TABLE public.pending_subscription_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pending_subscription_purchases FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_pending_apple_purchase(p_vessel_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  purchase_token UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_session_has_device_access() THEN
    RAISE EXCEPTION 'This device is not authorized for the account';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND vessel_id = p_vessel_id
      AND role = 'CAPTAIN_MOV'
  ) THEN
    RAISE EXCEPTION 'Only the Captain/MOV can purchase a vessel subscription';
  END IF;

  DELETE FROM public.pending_subscription_purchases
  WHERE expires_at < now() OR consumed_at IS NOT NULL;

  INSERT INTO public.pending_subscription_purchases (user_id, vessel_id, provider)
  VALUES (auth.uid(), p_vessel_id, 'apple')
  RETURNING id INTO purchase_token;

  RETURN purchase_token;
END;
$$;

REVOKE ALL ON FUNCTION public.create_pending_apple_purchase(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_apple_purchase(UUID) TO authenticated;

-- Safe subscription projection. Transaction IDs and provider purchase tokens
-- never leave the database through the authenticated API.
CREATE OR REPLACE FUNCTION public.get_vessel_subscription_entitlement(p_vessel_id UUID)
RETURNS TABLE (
  id UUID,
  vessel_id UUID,
  plan_tier TEXT,
  billing_period TEXT,
  status TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  grace_period_end TIMESTAMPTZ,
  payment_provider TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    subscription.id,
    subscription.vessel_id,
    subscription.plan_tier,
    subscription.billing_period,
    subscription.status,
    subscription.current_period_start,
    subscription.current_period_end,
    subscription.grace_period_end,
    subscription.payment_provider,
    subscription.created_at,
    subscription.updated_at
  FROM public.vessel_subscriptions AS subscription
  WHERE subscription.vessel_id = p_vessel_id
    AND public.current_session_has_device_access()
    AND EXISTS (
      SELECT 1 FROM public.users AS current_user_row
      WHERE current_user_row.id = auth.uid()
        AND current_user_row.vessel_id = p_vessel_id
    )
  ORDER BY subscription.current_period_end DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_vessel_subscription_entitlement(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vessel_subscription_entitlement(UUID) TO authenticated;
REVOKE SELECT ON public.vessel_subscriptions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_manage_rest_entry(
  target_user_id UUID,
  target_vessel_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.current_user_can_access_vessel(target_vessel_id)
    AND (
      public.current_user_is_captain_of(target_vessel_id)
      OR EXISTS (
        SELECT 1
        FROM public.users AS target_user
        JOIN public.department_signers AS signer
          ON signer.vessel_id = target_vessel_id
         AND signer.department = target_user.department
        WHERE target_user.id = target_user_id
          AND target_user.vessel_id = target_vessel_id
          AND signer.signer_user_id = auth.uid()
      )
    );
$$;

REVOKE ALL ON FUNCTION public.current_user_can_manage_rest_entry(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_rest_entry(UUID, UUID) TO authenticated;

-- Remove every pre-existing policy on the tables below. PostgreSQL combines
-- permissive policies with OR, so leaving one old USING(true) policy would
-- silently defeat the new restrictions.
DO $$
DECLARE
  table_name TEXT;
  old_policy RECORD;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'vessels', 'vessel_subscriptions',
    'trips', 'vessel_tasks', 'yard_period_jobs', 'contractors',
    'inventory_items', 'maintenance_logs', 'shopping_lists',
    'vessel_trip_colors', 'fuel_logs', 'general_waste_logs', 'pump_out_logs',
    'uniforms', 'notes', 'rest_entries', 'rotation_groups',
    'department_signers', 'watch_keepers', 'user_signatures', 'user_questions',
    'watch_keeping_timetables', 'watch_keeping_rules',
    'watch_duty_rules', 'watch_duty_groups', 'watch_duty_items',
    'watch_duty_completions', 'watch_assignments',
    'rules', 'safety_equipment', 'muster_stations',
    'pre_departure_checklists', 'pre_departure_checklist_items'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      FOR old_policy IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = table_name
      LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', old_policy.policyname, table_name);
      END LOOP;
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    END IF;
  END LOOP;
END
$$;

CREATE POLICY "Legacy app reads own subscription before enforcement activation"
  ON public.vessel_subscriptions FOR SELECT TO anon, authenticated
  USING (
    NOT public.security_enforcement_enabled()
    AND (
      auth.uid() IS NULL
      OR EXISTS (
        SELECT 1 FROM public.users AS current_user_row
        WHERE current_user_row.id = auth.uid()
          AND current_user_row.vessel_id = vessel_id
      )
    )
  );

CREATE POLICY "Users can read own profile or active vessel crew"
  ON public.users FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (vessel_id IS NOT NULL AND public.current_user_can_access_vessel(vessel_id))
  );

CREATE POLICY "Users create only their own unassigned profile"
  ON public.users FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid()
    AND (vessel_id IS NULL OR NOT public.security_enforcement_enabled())
  );

CREATE POLICY "Users edit own profile or Captain edits vessel crew"
  ON public.users FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
    OR public.current_user_is_captain_of(vessel_id)
  )
  WITH CHECK (
    id = auth.uid()
    OR public.current_captain_can_assign_profile(vessel_id)
  );

CREATE POLICY "Members can read their active vessel"
  ON public.vessels FOR SELECT TO authenticated
  USING (public.current_user_can_access_vessel(id));

GRANT SELECT ON public.vessels TO anon;
CREATE POLICY "Legacy app validates invites before enforcement activation"
  ON public.vessels FOR SELECT TO anon
  USING (NOT public.security_enforcement_enabled());

CREATE POLICY "Legacy app can create vessels before enforcement activation"
  ON public.vessels FOR INSERT TO authenticated
  WITH CHECK (NOT public.security_enforcement_enabled());

CREATE POLICY "Captain can update active vessel"
  ON public.vessels FOR UPDATE TO authenticated
  USING (public.current_user_is_captain_of(id))
  WITH CHECK (public.current_user_is_captain_of(id));

-- Tables where every active vessel member is allowed to create/edit/delete.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'trips', 'vessel_tasks', 'yard_period_jobs', 'contractors',
    'inventory_items', 'maintenance_logs', 'shopping_lists',
    'fuel_logs', 'general_waste_logs', 'pump_out_logs', 'uniforms'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.current_user_can_access_vessel(vessel_id)) WITH CHECK (public.current_user_can_access_vessel(vessel_id))',
        'Active vessel members can manage ' || table_name,
        table_name
      );
    END IF;
  END LOOP;
END
$$;

-- Personal notes remain private to their owner. A vessel role must not expose
-- somebody's private notes to other crew members.
CREATE POLICY "Members manage only their own notes"
  ON public.notes FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.current_user_can_access_vessel(vessel_id))
  WITH CHECK (user_id = auth.uid() AND public.current_user_can_access_vessel(vessel_id));

-- Crew own their rest records; Captains and explicitly assigned department
-- signers can review and confirm records for the crew they manage.
CREATE POLICY "Members and assigned reviewers read rest entries"
  ON public.rest_entries FOR SELECT TO authenticated
  USING (
    (user_id = auth.uid() AND public.current_user_can_access_vessel(vessel_id))
    OR public.current_user_can_manage_rest_entry(user_id, vessel_id)
  );
CREATE POLICY "Members create their own rest entries"
  ON public.rest_entries FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = auth.uid() AND status <> 'confirmed' AND public.current_user_can_access_vessel(vessel_id))
    OR public.current_user_can_manage_rest_entry(user_id, vessel_id)
  );
CREATE POLICY "Members and assigned reviewers update rest entries"
  ON public.rest_entries FOR UPDATE TO authenticated
  USING (
    (user_id = auth.uid() AND status <> 'confirmed' AND public.current_user_can_access_vessel(vessel_id))
    OR public.current_user_can_manage_rest_entry(user_id, vessel_id)
  )
  WITH CHECK (
    (user_id = auth.uid() AND status <> 'confirmed' AND public.current_user_can_access_vessel(vessel_id))
    OR public.current_user_can_manage_rest_entry(user_id, vessel_id)
  );
CREATE POLICY "Members and assigned reviewers delete rest entries"
  ON public.rest_entries FOR DELETE TO authenticated
  USING (
    (user_id = auth.uid() AND status <> 'confirmed' AND public.current_user_can_access_vessel(vessel_id))
    OR public.current_user_can_manage_rest_entry(user_id, vessel_id)
  );

-- Crew-management records are visible to the vessel, but only the Captain can
-- appoint signers, designate watch keepers, or manage rotation groups.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['rotation_groups', 'department_signers', 'watch_keepers'] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.current_user_can_access_vessel(vessel_id))',
        'Active vessel members can read ' || table_name,
        table_name
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.current_user_is_captain_of(vessel_id)) WITH CHECK (public.current_user_is_captain_of(vessel_id))',
        'Captain can manage ' || table_name,
        table_name
      );
    END IF;
  END LOOP;
END
$$;

CREATE POLICY "Vessel members can read signatures used on records"
  ON public.user_signatures FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.users AS signature_owner
      WHERE signature_owner.id = user_id
        AND public.current_user_can_access_vessel(signature_owner.vessel_id)
    )
  );
CREATE POLICY "Users manage only their own signature"
  ON public.user_signatures FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users submit only their own support questions"
  ON public.user_questions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      vessel_id IS NULL
      OR public.current_user_can_access_vessel(vessel_id)
    )
  );

-- HOD/Captain-managed tables with a direct vessel_id column.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vessel_trip_colors', 'watch_keeping_timetables', 'watch_keeping_rules',
    'watch_duty_rules', 'watch_duty_groups', 'watch_assignments',
    'rules', 'safety_equipment', 'muster_stations', 'pre_departure_checklists'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.current_user_can_access_vessel(vessel_id))',
        'Active vessel members can read ' || table_name,
        table_name
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.current_user_can_manage_vessel(vessel_id))',
        'HOD and Captain can create ' || table_name,
        table_name
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.current_user_can_manage_vessel(vessel_id)) WITH CHECK (public.current_user_can_manage_vessel(vessel_id))',
        'HOD and Captain can update ' || table_name,
        table_name
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.current_user_can_manage_vessel(vessel_id))',
        'HOD and Captain can delete ' || table_name,
        table_name
      );
    END IF;
  END LOOP;
END
$$;

-- Child records inherit access from their parent checklist/group.
DO $$
BEGIN
  IF to_regclass('public.pre_departure_checklist_items') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY "Members read checklist items" ON public.pre_departure_checklist_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.pre_departure_checklists parent WHERE parent.id = checklist_id AND public.current_user_can_access_vessel(parent.vessel_id)))';
    EXECUTE 'CREATE POLICY "Managers create checklist items" ON public.pre_departure_checklist_items FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.pre_departure_checklists parent WHERE parent.id = checklist_id AND public.current_user_can_manage_vessel(parent.vessel_id)))';
    EXECUTE 'CREATE POLICY "Managers update checklist items" ON public.pre_departure_checklist_items FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.pre_departure_checklists parent WHERE parent.id = checklist_id AND public.current_user_can_manage_vessel(parent.vessel_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.pre_departure_checklists parent WHERE parent.id = checklist_id AND public.current_user_can_manage_vessel(parent.vessel_id)))';
    EXECUTE 'CREATE POLICY "Managers delete checklist items" ON public.pre_departure_checklist_items FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.pre_departure_checklists parent WHERE parent.id = checklist_id AND public.current_user_can_manage_vessel(parent.vessel_id)))';
  END IF;

  IF to_regclass('public.watch_duty_items') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY "Members read duty items" ON public.watch_duty_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.watch_duty_groups parent WHERE parent.id = group_id AND public.current_user_can_access_vessel(parent.vessel_id)))';
    EXECUTE 'CREATE POLICY "Managers create duty items" ON public.watch_duty_items FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.watch_duty_groups parent WHERE parent.id = group_id AND public.current_user_can_manage_vessel(parent.vessel_id)))';
    EXECUTE 'CREATE POLICY "Managers update duty items" ON public.watch_duty_items FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.watch_duty_groups parent WHERE parent.id = group_id AND public.current_user_can_manage_vessel(parent.vessel_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.watch_duty_groups parent WHERE parent.id = group_id AND public.current_user_can_manage_vessel(parent.vessel_id)))';
    EXECUTE 'CREATE POLICY "Managers delete duty items" ON public.watch_duty_items FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.watch_duty_groups parent WHERE parent.id = group_id AND public.current_user_can_manage_vessel(parent.vessel_id)))';
  END IF;

  IF to_regclass('public.watch_duty_completions') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY "Members and managers read duty completions" ON public.watch_duty_completions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.watch_duty_items duty_item JOIN public.watch_duty_groups parent ON parent.id = duty_item.group_id WHERE duty_item.id = item_id AND ((user_id = auth.uid() AND public.current_user_can_access_vessel(parent.vessel_id)) OR public.current_user_can_manage_vessel(parent.vessel_id))))';
    EXECUTE 'CREATE POLICY "Members and managers create duty completions" ON public.watch_duty_completions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.watch_duty_items duty_item JOIN public.watch_duty_groups parent ON parent.id = duty_item.group_id WHERE duty_item.id = item_id AND ((user_id = auth.uid() AND public.current_user_can_access_vessel(parent.vessel_id)) OR public.current_user_can_manage_vessel(parent.vessel_id))))';
    EXECUTE 'CREATE POLICY "Members and managers update duty completions" ON public.watch_duty_completions FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.watch_duty_items duty_item JOIN public.watch_duty_groups parent ON parent.id = duty_item.group_id WHERE duty_item.id = item_id AND ((user_id = auth.uid() AND public.current_user_can_access_vessel(parent.vessel_id)) OR public.current_user_can_manage_vessel(parent.vessel_id)))) WITH CHECK (EXISTS (SELECT 1 FROM public.watch_duty_items duty_item JOIN public.watch_duty_groups parent ON parent.id = duty_item.group_id WHERE duty_item.id = item_id AND ((user_id = auth.uid() AND public.current_user_can_access_vessel(parent.vessel_id)) OR public.current_user_can_manage_vessel(parent.vessel_id))))';
    EXECUTE 'CREATE POLICY "Members and managers delete duty completions" ON public.watch_duty_completions FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.watch_duty_items duty_item JOIN public.watch_duty_groups parent ON parent.id = duty_item.group_id WHERE duty_item.id = item_id AND ((user_id = auth.uid() AND public.current_user_can_access_vessel(parent.vessel_id)) OR public.current_user_can_manage_vessel(parent.vessel_id))))';
  END IF;
END
$$;
