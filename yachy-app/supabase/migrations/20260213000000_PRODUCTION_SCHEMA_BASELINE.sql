-- Production public-schema baseline generated from the linked Supabase project on 2026-09-04.
-- Schema only: this file contains no customer rows.
-- The three Database Webhook triggers are intentionally excluded because Supabase
-- serializes their authorization headers into trigger definitions. Configure those
-- webhooks separately using TRIP_PUSH_NOTIFICATIONS_SETUP.md and never commit keys.
-- This baseline predates every timestamped migration so a clean database can replay
-- the complete schema history. It is not intended to be applied to production.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."can_manage_crew_member"("target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from users captain
    join users crew on crew.vessel_id = captain.vessel_id
    where captain.id = auth.uid()
      and captain.role = 'CAPTAIN_MOV'
      and crew.id = target_user_id
  );
$$;


ALTER FUNCTION "public"."can_manage_crew_member"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_rest_entry"("entry_user_id" "uuid", "entry_vessel_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from users where id = auth.uid() and role = 'CAPTAIN_MOV' and vessel_id = entry_vessel_id
  );
$$;


ALTER FUNCTION "public"."can_manage_rest_entry"("entry_user_id" "uuid", "entry_vessel_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_user_signature"("target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from users u1
    join users u2 on u1.vessel_id = u2.vessel_id
    where u1.id = auth.uid() and u2.id = target_user_id
  );
$$;


ALTER FUNCTION "public"."can_view_user_signature"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_vessel_mate"("target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from users viewer
    join users target on target.vessel_id = viewer.vessel_id
    where viewer.id = auth.uid()
      and target.id = target_user_id
      and viewer.vessel_id is not null
  );
$$;


ALTER FUNCTION "public"."can_view_vessel_mate"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_captain_vessel"("p_name" "text", "p_management_company_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."create_captain_vessel"("p_name" "text", "p_management_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_pending_apple_purchase"("p_vessel_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."create_pending_apple_purchase"("p_vessel_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_solo_vessel_for_current_user"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."create_solo_vessel_for_current_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_captain_can_assign_profile"("target_vessel_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."current_captain_can_assign_profile"("target_vessel_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_session_has_device_access"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT NOT public.security_enforcement_enabled()
    OR EXISTS (
      SELECT 1
      FROM public.user_devices AS device
      WHERE device.user_id = auth.uid()
        AND device.revoked_at IS NULL
        AND device.session_id::TEXT =
          current_setting('request.jwt.claims', true)::jsonb ->> 'session_id'
    );
$$;


ALTER FUNCTION "public"."current_session_has_device_access"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_can_access_vessel"("target_vessel_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."current_user_can_access_vessel"("target_vessel_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_can_access_vessel_storage_path"("p_vessel_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS current_user_row
    WHERE current_user_row.id = auth.uid()
      AND current_user_row.vessel_id::TEXT = p_vessel_id
  )
  AND public.current_session_has_device_access();
$$;


ALTER FUNCTION "public"."current_user_can_access_vessel_storage_path"("p_vessel_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_can_manage_rest_entry"("target_user_id" "uuid", "target_vessel_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."current_user_can_manage_rest_entry"("target_user_id" "uuid", "target_vessel_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_can_manage_vessel"("target_vessel_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."current_user_can_manage_vessel"("target_vessel_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_is_captain_for_storage_path"("p_vessel_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS current_user_row
    WHERE current_user_row.id = auth.uid()
      AND current_user_row.role = 'CAPTAIN_MOV'
      AND current_user_row.vessel_id::TEXT = p_vessel_id
  )
  AND public.current_session_has_device_access();
$$;


ALTER FUNCTION "public"."current_user_is_captain_for_storage_path"("p_vessel_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_is_captain_of"("target_vessel_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."current_user_is_captain_of"("target_vessel_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_vessel_invite_code"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."generate_vessel_invite_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_company_vessel_ids"("uid" "uuid") RETURNS SETOF "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select v.id
  from vessels v
  join user_company_roles ucr on ucr.company_id = v.management_company_id
  where ucr.user_id = uid;
$$;


ALTER FUNCTION "public"."get_company_vessel_ids"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_vessel_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select vessel_id from public.users where id = auth.uid()
$$;


ALTER FUNCTION "public"."get_my_vessel_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_vessel_subscription_entitlement"("p_vessel_id" "uuid") RETURNS TABLE("id" "uuid", "vessel_id" "uuid", "plan_tier" "text", "billing_period" "text", "status" "text", "current_period_start" timestamp with time zone, "current_period_end" timestamp with time zone, "grace_period_end" timestamp with time zone, "payment_provider" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."get_vessel_subscription_entitlement"("p_vessel_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_vessel_hod_or_captain"("target_vessel_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT public.current_user_can_manage_vessel(target_vessel_id);
$$;


ALTER FUNCTION "public"."is_vessel_hod_or_captain"("target_vessel_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_current_user_to_vessel"("p_invite_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."join_current_user_to_vessel"("p_invite_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_user_security_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."protect_user_security_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."regenerate_current_vessel_invite_code"("p_vessel_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."regenerate_current_vessel_invite_code"("p_vessel_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_user_device"("p_device_fingerprint" "text", "p_platform" "text", "p_device_name" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing public.user_devices%ROWTYPE;
  v_active_count INTEGER;
  v_session_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_device_fingerprint IS NULL OR length(trim(p_device_fingerprint)) < 16 THEN
    RAISE EXCEPTION 'Invalid device fingerprint';
  END IF;

  BEGIN
    v_session_id := NULLIF(
      current_setting('request.jwt.claims', true)::jsonb ->> 'session_id',
      ''
    )::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_session_id := NULL;
  END;

  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated session identifier required';
  END IF;

  -- Serialize claims for this account so simultaneous logins cannot both take
  -- the same final slot.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::TEXT, 0));

  SELECT *
  INTO v_existing
  FROM public.user_devices
  WHERE user_id = v_user_id
    AND device_fingerprint = p_device_fingerprint;

  IF FOUND AND v_existing.revoked_at IS NULL THEN
    UPDATE public.user_devices
    SET last_seen_at = now(),
        session_id = v_session_id,
        platform = p_platform,
        device_name = p_device_name
    WHERE id = v_existing.id;

    SELECT count(*) INTO v_active_count
    FROM public.user_devices
    WHERE user_id = v_user_id AND revoked_at IS NULL;

    RETURN jsonb_build_object('allowed', true, 'active_device_count', v_active_count);
  END IF;

  SELECT count(*) INTO v_active_count
  FROM public.user_devices
  WHERE user_id = v_user_id AND revoked_at IS NULL;

  IF v_active_count >= 2 THEN
    RETURN jsonb_build_object('allowed', false, 'active_device_count', v_active_count);
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.user_devices
    SET revoked_at = NULL,
        session_id = v_session_id,
        last_seen_at = now(),
        platform = p_platform,
        device_name = p_device_name
    WHERE id = v_existing.id;
  ELSE
    INSERT INTO public.user_devices (
      user_id,
      device_fingerprint,
      session_id,
      platform,
      device_name
    ) VALUES (
      v_user_id,
      p_device_fingerprint,
      v_session_id,
      p_platform,
      p_device_name
    );
  END IF;

  RETURN jsonb_build_object('allowed', true, 'active_device_count', v_active_count + 1);
END;
$$;


ALTER FUNCTION "public"."register_user_device"("p_device_fingerprint" "text", "p_platform" "text", "p_device_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_current_device"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_session_id TEXT :=
    current_setting('request.jwt.claims', true)::jsonb ->> 'session_id';
BEGIN
  IF auth.uid() IS NULL OR v_session_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.user_devices
  SET revoked_at = now(),
      session_id = NULL,
      last_seen_at = now()
  WHERE user_id = auth.uid()
    AND revoked_at IS NULL
    AND session_id::TEXT = v_session_id;

  RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."revoke_current_device"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."security_enforcement_enabled"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT COALESCE(
    (SELECT settings.enabled FROM public.security_enforcement_settings AS settings WHERE singleton),
    FALSE
  );
$$;


ALTER FUNCTION "public"."security_enforcement_enabled"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_vessel_invite_code"("p_invite_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."validate_vessel_invite_code"("p_invite_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vessel_subscription_allows_access"("target_vessel_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."vessel_subscription_allows_access"("target_vessel_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_updates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "status" "text" DEFAULT 'coming_soon'::"text" NOT NULL,
    "category" "text",
    "released_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."app_updates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."auth_links" (
    "code" "text" NOT NULL,
    "action_link" "text",
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."auth_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "paddle_subscription_id" "text",
    "paddle_customer_id" "text",
    "vessel_limit" integer DEFAULT 3 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contractors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "company_name" "text" NOT NULL,
    "company_address" "text",
    "description" "text",
    "contacts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "department" "text" DEFAULT 'INTERIOR'::"text" NOT NULL,
    "known_for" "text",
    CONSTRAINT "contractors_department_check" CHECK (("department" = ANY (ARRAY['BRIDGE'::"text", 'ENGINEERING'::"text", 'EXTERIOR'::"text", 'INTERIOR'::"text", 'GALLEY'::"text"])))
);


ALTER TABLE "public"."contractors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contracts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_size_bytes" integer,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."contracts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deleted_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email" "text",
    "name" "text",
    "role" "text",
    "vessel_id" "uuid",
    "deleted_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."deleted_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_signers" (
    "vessel_id" "uuid" NOT NULL,
    "department" "text" NOT NULL,
    "signer_user_id" "uuid" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "department_signers_department_check" CHECK (("department" = ANY (ARRAY['BRIDGE'::"text", 'ENGINEERING'::"text", 'EXTERIOR'::"text", 'INTERIOR'::"text", 'GALLEY'::"text"])))
);


ALTER TABLE "public"."department_signers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "payment_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."faqs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question" "text" NOT NULL,
    "answer" "text" NOT NULL,
    "display_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."faqs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fuel_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "location_of_refueling" "text",
    "log_date" "date" NOT NULL,
    "log_time" "text" NOT NULL,
    "amount_of_fuel" numeric(10,2) NOT NULL,
    "price_per_gallon" numeric(10,4) NOT NULL,
    "total_price" numeric(12,2) NOT NULL,
    "created_by_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fuel_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."general_waste_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "log_date" "date" NOT NULL,
    "log_time" "text" NOT NULL,
    "position_location" "text",
    "description_of_garbage" "text",
    "created_by_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "weight" numeric,
    "weight_unit" "text" DEFAULT 'kgs'::"text",
    CONSTRAINT "general_waste_logs_weight_unit_check" CHECK (("weight_unit" = ANY (ARRAY['kgs'::"text", 'lbs'::"text"])))
);


ALTER TABLE "public"."general_waste_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "department" "text" NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "inventory_categories_department_check" CHECK (("department" = ANY (ARRAY['DECK'::"text", 'INTERIOR'::"text", 'ENGINEERING'::"text", 'GALLEY'::"text"])))
);


ALTER TABLE "public"."inventory_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "quantity" integer DEFAULT 0 NOT NULL,
    "location" "text" NOT NULL,
    "department" "text" NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "photo" "text",
    "last_edited_by" "uuid",
    "last_edited_by_name" "text" NOT NULL,
    "last_edited_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "inventory_items_department_check" CHECK (("department" = ANY (ARRAY['BRIDGE'::"text", 'ENGINEERING'::"text", 'EXTERIOR'::"text", 'INTERIOR'::"text", 'GALLEY'::"text"])))
);


ALTER TABLE "public"."inventory_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."inventory_items"."items" IS 'JSONB array of { amount, item } rows';



CREATE TABLE IF NOT EXISTS "public"."maintenance_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "equipment" "text" NOT NULL,
    "serial_number" "text",
    "hours_of_service" "text",
    "hours_at_next_service" "text",
    "what_service_done" "text",
    "notes" "text",
    "service_done_by" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "port_starboard_na" "text"
);


ALTER TABLE "public"."maintenance_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."maintenance_logs" IS 'Maintenance log entries - equipment, service hours, what was done, by whom; persist until deleted';



COMMENT ON COLUMN "public"."maintenance_logs"."port_starboard_na" IS 'Port, Starboard or NA';



CREATE TABLE IF NOT EXISTS "public"."muster_stations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "data" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."muster_stations" OWNER TO "postgres";


COMMENT ON TABLE "public"."muster_stations" IS 'Published muster station plans - vessel crew can view and download';



CREATE TABLE IF NOT EXISTS "public"."notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "created_by_name" "text" DEFAULT 'Crew'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid"
);


ALTER TABLE "public"."notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pending_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "invited_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pending_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pending_subscription_purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '1 day'::interval) NOT NULL,
    "consumed_at" timestamp with time zone,
    CONSTRAINT "pending_subscription_purchases_provider_check" CHECK (("provider" = ANY (ARRAY['apple'::"text", 'google'::"text"])))
);


ALTER TABLE "public"."pending_subscription_purchases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pre_departure_checklist_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "checklist_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "checked" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pre_departure_checklist_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pre_departure_checklists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "trip_id" "uuid",
    "department" "text",
    "title" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "pre_departure_checklists_department_check" CHECK (("department" = ANY (ARRAY['BRIDGE'::"text", 'ENGINEERING'::"text", 'EXTERIOR'::"text", 'INTERIOR'::"text", 'GALLEY'::"text"])))
);


ALTER TABLE "public"."pre_departure_checklists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pump_out_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "discharge_type" "text" NOT NULL,
    "pumpout_service_name" "text",
    "location" "text",
    "amount_in_gallons" numeric(10,2) NOT NULL,
    "log_date" "date" NOT NULL,
    "log_time" "text" NOT NULL,
    "created_by_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text",
    CONSTRAINT "pump_out_logs_discharge_type_check" CHECK (("discharge_type" = ANY (ARRAY['DIRECT_DISCHARGE'::"text", 'TREATMENT_PLANT'::"text", 'PUMPOUT_SERVICE'::"text"])))
);


ALTER TABLE "public"."pump_out_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rest_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "rest_periods" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "work_start" "text",
    "work_end" "text",
    "lunch_start" "text",
    "lunch_end" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "confirmed_by" "uuid",
    "confirmed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "comment" "text"
);


ALTER TABLE "public"."rest_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rotation_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rotation_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "data" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."rules" OWNER TO "postgres";


COMMENT ON TABLE "public"."rules" IS 'Published general rules for all crew to conform to';



CREATE TABLE IF NOT EXISTS "public"."safety_equipment" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "data" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."safety_equipment" OWNER TO "postgres";


COMMENT ON TABLE "public"."safety_equipment" IS 'Published safety equipment location plans - vessel crew can view and download';



CREATE TABLE IF NOT EXISTS "public"."security_enforcement_settings" (
    "singleton" boolean DEFAULT true NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "security_enforcement_settings_singleton_check" CHECK ("singleton")
);


ALTER TABLE "public"."security_enforcement_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shopping_lists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "department" "text" NOT NULL,
    "title" "text" NOT NULL,
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "list_type" "text" DEFAULT 'general'::"text" NOT NULL,
    "is_master" boolean DEFAULT false NOT NULL,
    CONSTRAINT "shopping_lists_department_check" CHECK (("department" = ANY (ARRAY['BRIDGE'::"text", 'ENGINEERING'::"text", 'EXTERIOR'::"text", 'INTERIOR'::"text", 'GALLEY'::"text"]))),
    CONSTRAINT "shopping_lists_list_type_check" CHECK (("list_type" = ANY (ARRAY['general'::"text", 'trip'::"text"])))
);


ALTER TABLE "public"."shopping_lists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "vessel_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_by_name" "text" NOT NULL,
    "department" "text" NOT NULL,
    "assigned_to" "uuid",
    "assigned_to_name" "text",
    "timeframe" "text" NOT NULL,
    "deadline" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'NOT_STARTED'::"text" NOT NULL,
    "priority" "text" DEFAULT 'GREEN'::"text" NOT NULL,
    "claimed_by" "uuid",
    "claimed_by_name" "text",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "tasks_department_check" CHECK (("department" = ANY (ARRAY['DECK'::"text", 'INTERIOR'::"text", 'ENGINEERING'::"text", 'GALLEY'::"text"]))),
    CONSTRAINT "tasks_priority_check" CHECK (("priority" = ANY (ARRAY['GREEN'::"text", 'YELLOW'::"text", 'RED'::"text", 'OVERDUE'::"text"]))),
    CONSTRAINT "tasks_status_check" CHECK (("status" = ANY (ARRAY['NOT_STARTED'::"text", 'IN_PROGRESS'::"text", 'COMPLETED'::"text"]))),
    CONSTRAINT "tasks_timeframe_check" CHECK (("timeframe" = ANY (ARRAY['1_DAY'::"text", '3_DAYS'::"text", '1_WEEK'::"text", '2_WEEKS'::"text", '1_MONTH'::"text", 'CUSTOM'::"text"])))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "department" "text",
    "yard_location" "text",
    "contractor_company_name" "text",
    "contact_details" "text",
    CONSTRAINT "trips_department_check" CHECK (("department" = ANY (ARRAY['BRIDGE'::"text", 'ENGINEERING'::"text", 'EXTERIOR'::"text", 'INTERIOR'::"text", 'GALLEY'::"text"]))),
    CONSTRAINT "trips_type_check" CHECK (("type" = ANY (ARRAY['GUEST'::"text", 'BOSS'::"text", 'DELIVERY'::"text", 'YARD_PERIOD'::"text"])))
);


ALTER TABLE "public"."trips" OWNER TO "postgres";


COMMENT ON COLUMN "public"."trips"."department" IS 'Department for yard period trips; null for Guest/Boss/Delivery';



CREATE TABLE IF NOT EXISTS "public"."uniforms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "department" "text",
    "entries" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."uniforms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_company_roles" (
    "user_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'admin'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_company_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "device_fingerprint" "text" NOT NULL,
    "session_id" "uuid",
    "platform" "text" NOT NULL,
    "device_name" "text",
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone
);


ALTER TABLE "public"."user_devices" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_devices" IS 'Hashed device installations registered to an account. Two active devices maximum.';



CREATE TABLE IF NOT EXISTS "public"."user_questions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "vessel_id" "uuid",
    "user_name" "text",
    "user_email" "text",
    "question" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "answer" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_questions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_signatures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "signature_type" "text" NOT NULL,
    "signature_image" "text",
    "typed_name" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_signatures_signature_type_check" CHECK (("signature_type" = ANY (ARRAY['drawn'::"text", 'typed'::"text"])))
);


ALTER TABLE "public"."user_signatures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_vessel_memberships" (
    "user_id" "uuid" NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_vessel_memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "name" "text" NOT NULL,
    "position" "text" NOT NULL,
    "department" "text" NOT NULL,
    "role" "text" DEFAULT 'CREW'::"text" NOT NULL,
    "vessel_id" "uuid",
    "profile_photo" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "push_token" "text",
    "notification_preferences" "jsonb" DEFAULT '{"tasks": true, "trips": true, "yardJobs": true, "maintenance": true, "preDeparture": true, "watchSchedule": true}'::"jsonb",
    "department_2" "text",
    "contract_type" "text" DEFAULT 'permanent'::"text" NOT NULL,
    "rotation_group_id" "uuid",
    "paused" boolean DEFAULT false,
    "vessel_joined_at" timestamp with time zone,
    CONSTRAINT "users_contract_type_check" CHECK (("contract_type" = ANY (ARRAY['permanent'::"text", 'temporary'::"text", 'rotational'::"text"]))),
    CONSTRAINT "users_department_2_check" CHECK ((("department_2" IS NULL) OR ("department_2" = ANY (ARRAY['BRIDGE'::"text", 'ENGINEERING'::"text", 'EXTERIOR'::"text", 'INTERIOR'::"text", 'GALLEY'::"text"])))),
    CONSTRAINT "users_department_check" CHECK (("department" = ANY (ARRAY['BRIDGE'::"text", 'ENGINEERING'::"text", 'EXTERIOR'::"text", 'INTERIOR'::"text", 'GALLEY'::"text"]))),
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['HOD'::"text", 'CREW'::"text", 'MANAGEMENT'::"text", 'CAPTAIN_MOV'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON COLUMN "public"."users"."push_token" IS 'Expo push token for notifications';



COMMENT ON COLUMN "public"."users"."notification_preferences" IS 'User preferences for which notification types to receive';



CREATE TABLE IF NOT EXISTS "public"."vessel_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "plan_tier" "text" NOT NULL,
    "billing_period" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "paddle_subscription_id" "text",
    "paddle_customer_id" "text",
    "revenuecat_subscriber_id" "text",
    "current_period_start" timestamp with time zone NOT NULL,
    "current_period_end" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payment_provider" "text",
    "grace_period_end" timestamp with time zone,
    "billing_retry_started_at" timestamp with time zone,
    "apple_original_transaction_id" "text",
    "apple_latest_transaction_id" "text",
    "google_purchase_token" "text",
    "google_order_id" "text",
    "last_verified_at" timestamp with time zone,
    CONSTRAINT "vessel_subscriptions_billing_period_check" CHECK (("billing_period" = ANY (ARRAY['monthly'::"text", '3_months'::"text", '6_months'::"text", '12_months'::"text"]))),
    CONSTRAINT "vessel_subscriptions_payment_provider_check" CHECK ((("payment_provider" IS NULL) OR ("payment_provider" = ANY (ARRAY['apple'::"text", 'google'::"text", 'paddle'::"text"])))),
    CONSTRAINT "vessel_subscriptions_plan_tier_check" CHECK (("plan_tier" = ANY (ARRAY['1_5'::"text", '6_10'::"text", '11_15'::"text", '16_25'::"text", '26_40'::"text", '40_plus'::"text"]))),
    CONSTRAINT "vessel_subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'past_due'::"text", 'canceled'::"text", 'trialing'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."vessel_subscriptions" OWNER TO "postgres";


COMMENT ON TABLE "public"."vessel_subscriptions" IS 'Subscription plans for vessels; Captain pays before invite code access';



COMMENT ON COLUMN "public"."vessel_subscriptions"."paddle_subscription_id" IS 'Paddle Billing subscription id (sub_*)';



COMMENT ON COLUMN "public"."vessel_subscriptions"."paddle_customer_id" IS 'Paddle Billing customer id (ctm_*)';



COMMENT ON COLUMN "public"."vessel_subscriptions"."payment_provider" IS 'Active Nautical Ops providers are apple and google. Paddle is retained only for historical row compatibility and must not be used for new Nautical Ops purchases.';



COMMENT ON COLUMN "public"."vessel_subscriptions"."grace_period_end" IS 'Authoritative provider grace expiry. Legacy failed renewals fall back to current_period_end + 16 days in application access checks.';



COMMENT ON COLUMN "public"."vessel_subscriptions"."apple_original_transaction_id" IS 'Stable Apple subscription-chain identifier; unique to prevent one purchase being attached to multiple vessels.';



COMMENT ON COLUMN "public"."vessel_subscriptions"."google_purchase_token" IS 'Google Play purchase token; unique to prevent one purchase being attached to multiple vessels.';



CREATE TABLE IF NOT EXISTS "public"."vessel_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "title" "text" NOT NULL,
    "notes" "text",
    "done_by_date" "date",
    "status" "text" DEFAULT 'NOT_STARTED'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_by" "uuid",
    "completed_at" timestamp with time zone,
    "completed_by_name" "text",
    "recurring" "text",
    "department" "text" DEFAULT 'INTERIOR'::"text" NOT NULL,
    CONSTRAINT "vessel_tasks_category_check" CHECK (("category" = ANY (ARRAY['DAILY'::"text", 'WEEKLY'::"text", 'MONTHLY'::"text"]))),
    CONSTRAINT "vessel_tasks_department_check" CHECK (("department" = ANY (ARRAY['BRIDGE'::"text", 'ENGINEERING'::"text", 'EXTERIOR'::"text", 'INTERIOR'::"text", 'GALLEY'::"text"]))),
    CONSTRAINT "vessel_tasks_recurring_check" CHECK (("recurring" = ANY (ARRAY['7_DAYS'::"text", '14_DAYS'::"text", '30_DAYS'::"text"]))),
    CONSTRAINT "vessel_tasks_status_check" CHECK (("status" = ANY (ARRAY['NOT_STARTED'::"text", 'IN_PROGRESS'::"text", 'COMPLETED'::"text"])))
);


ALTER TABLE "public"."vessel_tasks" OWNER TO "postgres";


COMMENT ON TABLE "public"."vessel_tasks" IS 'Daily, Weekly, Monthly tasks for vessel operations';



CREATE TABLE IF NOT EXISTS "public"."vessel_trip_colors" (
    "vessel_id" "uuid" NOT NULL,
    "guest_trip_color" "text",
    "boss_trip_color" "text",
    "delivery_trip_color" "text",
    "yard_period_color" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vessel_trip_colors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vessels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "management_company_id" "uuid",
    "invite_code" "text" NOT NULL,
    "invite_expiry" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "imo_number" "text",
    "is_solo" boolean DEFAULT false
);


ALTER TABLE "public"."vessels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."watch_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "start_time" "text" NOT NULL,
    "end_time" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."watch_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."watch_duty_completions" (
    "user_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "checked" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."watch_duty_completions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."watch_duty_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "department" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "watch_duty_groups_department_check" CHECK (("department" = ANY (ARRAY['BRIDGE'::"text", 'ENGINEERING'::"text", 'EXTERIOR'::"text", 'INTERIOR'::"text", 'GALLEY'::"text"])))
);


ALTER TABLE "public"."watch_duty_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."watch_duty_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."watch_duty_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."watch_duty_rules" (
    "vessel_id" "uuid" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."watch_duty_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."watch_keepers" (
    "vessel_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."watch_keepers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."watch_keeping_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid"
);


ALTER TABLE "public"."watch_keeping_rules" OWNER TO "postgres";


COMMENT ON TABLE "public"."watch_keeping_rules" IS 'Watch keeping rules text; HODs edit, crew view';



CREATE TABLE IF NOT EXISTS "public"."watch_keeping_timetables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "watch_title" "text" NOT NULL,
    "start_time" "text" NOT NULL,
    "start_location" "text",
    "destination" "text",
    "notes" "text",
    "for_date" "date",
    "slots" "jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."watch_keeping_timetables" OWNER TO "postgres";


COMMENT ON TABLE "public"."watch_keeping_timetables" IS 'Published watch keeping timetables visible to crew on calendar';



CREATE TABLE IF NOT EXISTS "public"."yard_period_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vessel_id" "uuid" NOT NULL,
    "job_title" "text" NOT NULL,
    "job_description" "text",
    "yard_location" "text",
    "contractor_company_name" "text",
    "contact_details" "text",
    "done_by_date" "text",
    "status" "text" DEFAULT 'NOT_STARTED'::"text" NOT NULL,
    "completed_by" "uuid",
    "completed_at" timestamp with time zone,
    "completed_by_name" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "department" "text" DEFAULT 'INTERIOR'::"text" NOT NULL,
    "priority" "text" DEFAULT 'GREEN'::"text" NOT NULL,
    "trip_id" "uuid",
    "defect_details" "text",
    "defect_location" "text",
    "equipment_serial" "text",
    CONSTRAINT "yard_period_jobs_department_check" CHECK (("department" = ANY (ARRAY['BRIDGE'::"text", 'ENGINEERING'::"text", 'EXTERIOR'::"text", 'INTERIOR'::"text", 'GALLEY'::"text"]))),
    CONSTRAINT "yard_period_jobs_priority_check" CHECK (("priority" = ANY (ARRAY['GREEN'::"text", 'YELLOW'::"text", 'RED'::"text"]))),
    CONSTRAINT "yard_period_jobs_status_check" CHECK (("status" = ANY (ARRAY['NOT_STARTED'::"text", 'IN_PROGRESS'::"text", 'COMPLETED'::"text"])))
);


ALTER TABLE "public"."yard_period_jobs" OWNER TO "postgres";


ALTER TABLE ONLY "public"."app_updates"
    ADD CONSTRAINT "app_updates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auth_links"
    ADD CONSTRAINT "auth_links_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contractors"
    ADD CONSTRAINT "contractors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deleted_users"
    ADD CONSTRAINT "deleted_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_signers"
    ADD CONSTRAINT "department_signers_pkey" PRIMARY KEY ("vessel_id", "department");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."faqs"
    ADD CONSTRAINT "faqs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fuel_logs"
    ADD CONSTRAINT "fuel_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."general_waste_logs"
    ADD CONSTRAINT "general_waste_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_categories"
    ADD CONSTRAINT "inventory_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."maintenance_logs"
    ADD CONSTRAINT "maintenance_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."muster_stations"
    ADD CONSTRAINT "muster_stations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_invites"
    ADD CONSTRAINT "pending_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_subscription_purchases"
    ADD CONSTRAINT "pending_subscription_purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pre_departure_checklist_items"
    ADD CONSTRAINT "pre_departure_checklist_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pre_departure_checklists"
    ADD CONSTRAINT "pre_departure_checklists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pump_out_logs"
    ADD CONSTRAINT "pump_out_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rest_entries"
    ADD CONSTRAINT "rest_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rest_entries"
    ADD CONSTRAINT "rest_entries_user_id_date_key" UNIQUE ("user_id", "date");



ALTER TABLE ONLY "public"."rotation_groups"
    ADD CONSTRAINT "rotation_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rules"
    ADD CONSTRAINT "rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."safety_equipment"
    ADD CONSTRAINT "safety_equipment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."security_enforcement_settings"
    ADD CONSTRAINT "security_enforcement_settings_pkey" PRIMARY KEY ("singleton");



ALTER TABLE ONLY "public"."shopping_lists"
    ADD CONSTRAINT "shopping_lists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trips"
    ADD CONSTRAINT "trips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."uniforms"
    ADD CONSTRAINT "uniforms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_company_roles"
    ADD CONSTRAINT "user_company_roles_pkey" PRIMARY KEY ("user_id", "company_id");



ALTER TABLE ONLY "public"."user_devices"
    ADD CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_devices"
    ADD CONSTRAINT "user_devices_user_id_device_fingerprint_key" UNIQUE ("user_id", "device_fingerprint");



ALTER TABLE ONLY "public"."user_questions"
    ADD CONSTRAINT "user_questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_signatures"
    ADD CONSTRAINT "user_signatures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_signatures"
    ADD CONSTRAINT "user_signatures_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_vessel_memberships"
    ADD CONSTRAINT "user_vessel_memberships_pkey" PRIMARY KEY ("user_id", "vessel_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vessel_subscriptions"
    ADD CONSTRAINT "vessel_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vessel_tasks"
    ADD CONSTRAINT "vessel_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vessel_trip_colors"
    ADD CONSTRAINT "vessel_trip_colors_pkey" PRIMARY KEY ("vessel_id");



ALTER TABLE ONLY "public"."vessels"
    ADD CONSTRAINT "vessels_invite_code_key" UNIQUE ("invite_code");



ALTER TABLE ONLY "public"."vessels"
    ADD CONSTRAINT "vessels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."watch_assignments"
    ADD CONSTRAINT "watch_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."watch_duty_completions"
    ADD CONSTRAINT "watch_duty_completions_pkey" PRIMARY KEY ("user_id", "item_id");



ALTER TABLE ONLY "public"."watch_duty_groups"
    ADD CONSTRAINT "watch_duty_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."watch_duty_items"
    ADD CONSTRAINT "watch_duty_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."watch_duty_rules"
    ADD CONSTRAINT "watch_duty_rules_pkey" PRIMARY KEY ("vessel_id");



ALTER TABLE ONLY "public"."watch_keepers"
    ADD CONSTRAINT "watch_keepers_pkey" PRIMARY KEY ("vessel_id", "user_id");



ALTER TABLE ONLY "public"."watch_keeping_rules"
    ADD CONSTRAINT "watch_keeping_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."watch_keeping_rules"
    ADD CONSTRAINT "watch_keeping_rules_vessel_id_key" UNIQUE ("vessel_id");



ALTER TABLE ONLY "public"."watch_keeping_timetables"
    ADD CONSTRAINT "watch_keeping_timetables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."yard_period_jobs"
    ADD CONSTRAINT "yard_period_jobs_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_general_waste_logs_vessel_date" ON "public"."general_waste_logs" USING "btree" ("vessel_id", "log_date" DESC);



CREATE INDEX "idx_maintenance_logs_created_at" ON "public"."maintenance_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_maintenance_logs_vessel_id" ON "public"."maintenance_logs" USING "btree" ("vessel_id");



CREATE INDEX "idx_muster_stations_created" ON "public"."muster_stations" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_muster_stations_vessel" ON "public"."muster_stations" USING "btree" ("vessel_id");



CREATE INDEX "idx_muster_stations_vessel_id" ON "public"."muster_stations" USING "btree" ("vessel_id");



CREATE INDEX "idx_pending_subscription_purchases_lookup" ON "public"."pending_subscription_purchases" USING "btree" ("id", "provider") WHERE ("consumed_at" IS NULL);



CREATE INDEX "idx_pre_departure_checklist_items_checklist" ON "public"."pre_departure_checklist_items" USING "btree" ("checklist_id");



CREATE INDEX "idx_pre_departure_checklists_trip" ON "public"."pre_departure_checklists" USING "btree" ("trip_id");



CREATE INDEX "idx_pre_departure_checklists_vessel" ON "public"."pre_departure_checklists" USING "btree" ("vessel_id");



CREATE INDEX "idx_rules_created" ON "public"."rules" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_rules_vessel" ON "public"."rules" USING "btree" ("vessel_id");



CREATE INDEX "idx_safety_equipment_created" ON "public"."safety_equipment" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_safety_equipment_vessel" ON "public"."safety_equipment" USING "btree" ("vessel_id");



CREATE INDEX "idx_shopping_lists_department" ON "public"."shopping_lists" USING "btree" ("department");



CREATE INDEX "idx_shopping_lists_vessel_id" ON "public"."shopping_lists" USING "btree" ("vessel_id");



CREATE INDEX "idx_trips_dates" ON "public"."trips" USING "btree" ("start_date", "end_date");



CREATE INDEX "idx_trips_department" ON "public"."trips" USING "btree" ("vessel_id", "type", "department");



CREATE INDEX "idx_trips_vessel_id" ON "public"."trips" USING "btree" ("vessel_id");



CREATE INDEX "idx_trips_vessel_type" ON "public"."trips" USING "btree" ("vessel_id", "type");



CREATE INDEX "idx_user_devices_active" ON "public"."user_devices" USING "btree" ("user_id") WHERE ("revoked_at" IS NULL);



CREATE UNIQUE INDEX "idx_user_devices_session" ON "public"."user_devices" USING "btree" ("session_id") WHERE (("session_id" IS NOT NULL) AND ("revoked_at" IS NULL));



CREATE UNIQUE INDEX "idx_vessel_subscriptions_apple_original_transaction" ON "public"."vessel_subscriptions" USING "btree" ("apple_original_transaction_id") WHERE ("apple_original_transaction_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_vessel_subscriptions_google_purchase_token" ON "public"."vessel_subscriptions" USING "btree" ("google_purchase_token") WHERE ("google_purchase_token" IS NOT NULL);



CREATE INDEX "idx_vessel_subscriptions_paddle" ON "public"."vessel_subscriptions" USING "btree" ("paddle_subscription_id") WHERE ("paddle_subscription_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_vessel_subscriptions_vessel_id" ON "public"."vessel_subscriptions" USING "btree" ("vessel_id");



CREATE INDEX "idx_vessel_tasks_category" ON "public"."vessel_tasks" USING "btree" ("vessel_id", "category");



CREATE INDEX "idx_vessel_tasks_department" ON "public"."vessel_tasks" USING "btree" ("vessel_id", "department");



CREATE INDEX "idx_vessel_tasks_done_by" ON "public"."vessel_tasks" USING "btree" ("done_by_date") WHERE ("done_by_date" IS NOT NULL);



CREATE INDEX "idx_vessel_tasks_vessel_id" ON "public"."vessel_tasks" USING "btree" ("vessel_id");



CREATE INDEX "idx_watch_rules_vessel_id" ON "public"."watch_keeping_rules" USING "btree" ("vessel_id");



CREATE INDEX "idx_watch_timetables_for_date" ON "public"."watch_keeping_timetables" USING "btree" ("for_date");



CREATE INDEX "idx_watch_timetables_vessel_id" ON "public"."watch_keeping_timetables" USING "btree" ("vessel_id");



CREATE INDEX "idx_yard_period_jobs_done_by" ON "public"."yard_period_jobs" USING "btree" ("done_by_date") WHERE ("done_by_date" IS NOT NULL);



CREATE INDEX "idx_yard_period_jobs_vessel_id" ON "public"."yard_period_jobs" USING "btree" ("vessel_id");






CREATE OR REPLACE TRIGGER "protect_user_security_fields_trigger" BEFORE INSERT OR UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."protect_user_security_fields"();



CREATE OR REPLACE TRIGGER "update_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();









ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."contractors"
    ADD CONSTRAINT "contractors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."contractors"
    ADD CONSTRAINT "contractors_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contracts"
    ADD CONSTRAINT "contracts_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_signers"
    ADD CONSTRAINT "department_signers_signer_user_id_fkey" FOREIGN KEY ("signer_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."department_signers"
    ADD CONSTRAINT "department_signers_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fuel_logs"
    ADD CONSTRAINT "fuel_logs_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."general_waste_logs"
    ADD CONSTRAINT "general_waste_logs_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_categories"
    ADD CONSTRAINT "inventory_categories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventory_categories"
    ADD CONSTRAINT "inventory_categories_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."inventory_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_last_edited_by_fkey" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."maintenance_logs"
    ADD CONSTRAINT "maintenance_logs_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."muster_stations"
    ADD CONSTRAINT "muster_stations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."muster_stations"
    ADD CONSTRAINT "muster_stations_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pending_invites"
    ADD CONSTRAINT "pending_invites_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."pending_invites"
    ADD CONSTRAINT "pending_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pending_subscription_purchases"
    ADD CONSTRAINT "pending_subscription_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pending_subscription_purchases"
    ADD CONSTRAINT "pending_subscription_purchases_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pre_departure_checklist_items"
    ADD CONSTRAINT "pre_departure_checklist_items_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "public"."pre_departure_checklists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pre_departure_checklists"
    ADD CONSTRAINT "pre_departure_checklists_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."pre_departure_checklists"
    ADD CONSTRAINT "pre_departure_checklists_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pre_departure_checklists"
    ADD CONSTRAINT "pre_departure_checklists_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pump_out_logs"
    ADD CONSTRAINT "pump_out_logs_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rest_entries"
    ADD CONSTRAINT "rest_entries_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rest_entries"
    ADD CONSTRAINT "rest_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rest_entries"
    ADD CONSTRAINT "rest_entries_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rotation_groups"
    ADD CONSTRAINT "rotation_groups_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rules"
    ADD CONSTRAINT "rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."rules"
    ADD CONSTRAINT "rules_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."safety_equipment"
    ADD CONSTRAINT "safety_equipment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."safety_equipment"
    ADD CONSTRAINT "safety_equipment_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shopping_lists"
    ADD CONSTRAINT "shopping_lists_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."shopping_lists"
    ADD CONSTRAINT "shopping_lists_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trips"
    ADD CONSTRAINT "trips_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."trips"
    ADD CONSTRAINT "trips_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."uniforms"
    ADD CONSTRAINT "uniforms_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."uniforms"
    ADD CONSTRAINT "uniforms_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_company_roles"
    ADD CONSTRAINT "user_company_roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."user_company_roles"
    ADD CONSTRAINT "user_company_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_devices"
    ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_questions"
    ADD CONSTRAINT "user_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_questions"
    ADD CONSTRAINT "user_questions_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_signatures"
    ADD CONSTRAINT "user_signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_vessel_memberships"
    ADD CONSTRAINT "user_vessel_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_vessel_memberships"
    ADD CONSTRAINT "user_vessel_memberships_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vessel_subscriptions"
    ADD CONSTRAINT "vessel_subscriptions_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vessel_tasks"
    ADD CONSTRAINT "vessel_tasks_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."vessel_tasks"
    ADD CONSTRAINT "vessel_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."vessel_tasks"
    ADD CONSTRAINT "vessel_tasks_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vessel_trip_colors"
    ADD CONSTRAINT "vessel_trip_colors_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vessels"
    ADD CONSTRAINT "vessels_management_company_fk" FOREIGN KEY ("management_company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."watch_assignments"
    ADD CONSTRAINT "watch_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."watch_assignments"
    ADD CONSTRAINT "watch_assignments_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."watch_duty_completions"
    ADD CONSTRAINT "watch_duty_completions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."watch_duty_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."watch_duty_completions"
    ADD CONSTRAINT "watch_duty_completions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."watch_duty_groups"
    ADD CONSTRAINT "watch_duty_groups_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."watch_duty_items"
    ADD CONSTRAINT "watch_duty_items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."watch_duty_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."watch_duty_rules"
    ADD CONSTRAINT "watch_duty_rules_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."watch_keepers"
    ADD CONSTRAINT "watch_keepers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."watch_keepers"
    ADD CONSTRAINT "watch_keepers_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."watch_keeping_rules"
    ADD CONSTRAINT "watch_keeping_rules_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."watch_keeping_rules"
    ADD CONSTRAINT "watch_keeping_rules_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."watch_keeping_timetables"
    ADD CONSTRAINT "watch_keeping_timetables_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."watch_keeping_timetables"
    ADD CONSTRAINT "watch_keeping_timetables_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."yard_period_jobs"
    ADD CONSTRAINT "yard_period_jobs_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."yard_period_jobs"
    ADD CONSTRAINT "yard_period_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."yard_period_jobs"
    ADD CONSTRAINT "yard_period_jobs_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."yard_period_jobs"
    ADD CONSTRAINT "yard_period_jobs_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id") ON DELETE CASCADE;



CREATE POLICY "Active vessel members can manage contractors" ON "public"."contractors" TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can manage fuel_logs" ON "public"."fuel_logs" TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can manage general_waste_logs" ON "public"."general_waste_logs" TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can manage inventory_items" ON "public"."inventory_items" TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can manage maintenance_logs" ON "public"."maintenance_logs" TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can manage pump_out_logs" ON "public"."pump_out_logs" TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can manage shopping_lists" ON "public"."shopping_lists" TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can manage trips" ON "public"."trips" TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can manage uniforms" ON "public"."uniforms" TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can manage vessel_tasks" ON "public"."vessel_tasks" TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can manage yard_period_jobs" ON "public"."yard_period_jobs" TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can read department_signers" ON "public"."department_signers" FOR SELECT TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can read muster_stations" ON "public"."muster_stations" FOR SELECT TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can read pre_departure_checklists" ON "public"."pre_departure_checklists" FOR SELECT TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can read rotation_groups" ON "public"."rotation_groups" FOR SELECT TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can read rules" ON "public"."rules" FOR SELECT TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can read safety_equipment" ON "public"."safety_equipment" FOR SELECT TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can read vessel_trip_colors" ON "public"."vessel_trip_colors" FOR SELECT TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can read watch_assignments" ON "public"."watch_assignments" FOR SELECT TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can read watch_duty_groups" ON "public"."watch_duty_groups" FOR SELECT TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can read watch_duty_rules" ON "public"."watch_duty_rules" FOR SELECT TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can read watch_keepers" ON "public"."watch_keepers" FOR SELECT TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can read watch_keeping_rules" ON "public"."watch_keeping_rules" FOR SELECT TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Active vessel members can read watch_keeping_timetables" ON "public"."watch_keeping_timetables" FOR SELECT TO "authenticated" USING ("public"."current_user_can_access_vessel"("vessel_id"));



CREATE POLICY "Anyone can read faqs" ON "public"."faqs" FOR SELECT USING (true);



CREATE POLICY "Authenticated users can read app updates" ON "public"."app_updates" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Captain can manage department_signers" ON "public"."department_signers" TO "authenticated" USING ("public"."current_user_is_captain_of"("vessel_id")) WITH CHECK ("public"."current_user_is_captain_of"("vessel_id"));



CREATE POLICY "Captain can manage rotation_groups" ON "public"."rotation_groups" TO "authenticated" USING ("public"."current_user_is_captain_of"("vessel_id")) WITH CHECK ("public"."current_user_is_captain_of"("vessel_id"));



CREATE POLICY "Captain can manage watch_keepers" ON "public"."watch_keepers" TO "authenticated" USING ("public"."current_user_is_captain_of"("vessel_id")) WITH CHECK ("public"."current_user_is_captain_of"("vessel_id"));



CREATE POLICY "Captain can update active vessel" ON "public"."vessels" FOR UPDATE TO "authenticated" USING ("public"."current_user_is_captain_of"("id")) WITH CHECK ("public"."current_user_is_captain_of"("id"));



CREATE POLICY "Company members can view contracts for their vessels" ON "public"."contracts" FOR SELECT USING (("vessel_id" IN ( SELECT "v"."id"
   FROM ("public"."vessels" "v"
     JOIN "public"."user_company_roles" "ucr" ON (("ucr"."company_id" = "v"."management_company_id")))
  WHERE ("ucr"."user_id" = "auth"."uid"()))));



CREATE POLICY "Company members can view their pending invites" ON "public"."pending_invites" FOR SELECT USING (("company_id" IN ( SELECT "user_company_roles"."company_id"
   FROM "public"."user_company_roles"
  WHERE ("user_company_roles"."user_id" = "auth"."uid"()))));



CREATE POLICY "HOD and Captain can create muster_stations" ON "public"."muster_stations" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can create pre_departure_checklists" ON "public"."pre_departure_checklists" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can create rules" ON "public"."rules" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can create safety_equipment" ON "public"."safety_equipment" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can create vessel_trip_colors" ON "public"."vessel_trip_colors" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can create watch_assignments" ON "public"."watch_assignments" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can create watch_duty_groups" ON "public"."watch_duty_groups" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can create watch_duty_rules" ON "public"."watch_duty_rules" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can create watch_keeping_rules" ON "public"."watch_keeping_rules" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can create watch_keeping_timetables" ON "public"."watch_keeping_timetables" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can delete muster_stations" ON "public"."muster_stations" FOR DELETE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can delete pre_departure_checklists" ON "public"."pre_departure_checklists" FOR DELETE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can delete rules" ON "public"."rules" FOR DELETE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can delete safety_equipment" ON "public"."safety_equipment" FOR DELETE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can delete vessel_trip_colors" ON "public"."vessel_trip_colors" FOR DELETE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can delete watch_assignments" ON "public"."watch_assignments" FOR DELETE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can delete watch_duty_groups" ON "public"."watch_duty_groups" FOR DELETE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can delete watch_duty_rules" ON "public"."watch_duty_rules" FOR DELETE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can delete watch_keeping_rules" ON "public"."watch_keeping_rules" FOR DELETE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can delete watch_keeping_timetables" ON "public"."watch_keeping_timetables" FOR DELETE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can update muster_stations" ON "public"."muster_stations" FOR UPDATE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can update pre_departure_checklists" ON "public"."pre_departure_checklists" FOR UPDATE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can update rules" ON "public"."rules" FOR UPDATE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can update safety_equipment" ON "public"."safety_equipment" FOR UPDATE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can update vessel_trip_colors" ON "public"."vessel_trip_colors" FOR UPDATE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can update watch_assignments" ON "public"."watch_assignments" FOR UPDATE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can update watch_duty_groups" ON "public"."watch_duty_groups" FOR UPDATE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can update watch_duty_rules" ON "public"."watch_duty_rules" FOR UPDATE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can update watch_keeping_rules" ON "public"."watch_keeping_rules" FOR UPDATE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "HOD and Captain can update watch_keeping_timetables" ON "public"."watch_keeping_timetables" FOR UPDATE TO "authenticated" USING ("public"."current_user_can_manage_vessel"("vessel_id")) WITH CHECK ("public"."current_user_can_manage_vessel"("vessel_id"));



CREATE POLICY "Legacy app can create vessels before enforcement activation" ON "public"."vessels" FOR INSERT TO "authenticated" WITH CHECK ((NOT "public"."security_enforcement_enabled"()));



CREATE POLICY "Legacy app reads own subscription before enforcement activation" ON "public"."vessel_subscriptions" FOR SELECT TO "authenticated", "anon" USING (((NOT "public"."security_enforcement_enabled"()) AND (("auth"."uid"() IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."users" "current_user_row"
  WHERE (("current_user_row"."id" = "auth"."uid"()) AND ("current_user_row"."vessel_id" = "current_user_row"."vessel_id")))))));



CREATE POLICY "Legacy app validates invites before enforcement activation" ON "public"."vessels" FOR SELECT TO "anon" USING ((NOT "public"."security_enforcement_enabled"()));



CREATE POLICY "Managers create checklist items" ON "public"."pre_departure_checklist_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."pre_departure_checklists" "parent"
  WHERE (("parent"."id" = "pre_departure_checklist_items"."checklist_id") AND "public"."current_user_can_manage_vessel"("parent"."vessel_id")))));



CREATE POLICY "Managers create duty items" ON "public"."watch_duty_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."watch_duty_groups" "parent"
  WHERE (("parent"."id" = "watch_duty_items"."group_id") AND "public"."current_user_can_manage_vessel"("parent"."vessel_id")))));



CREATE POLICY "Managers delete checklist items" ON "public"."pre_departure_checklist_items" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."pre_departure_checklists" "parent"
  WHERE (("parent"."id" = "pre_departure_checklist_items"."checklist_id") AND "public"."current_user_can_manage_vessel"("parent"."vessel_id")))));



CREATE POLICY "Managers delete duty items" ON "public"."watch_duty_items" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."watch_duty_groups" "parent"
  WHERE (("parent"."id" = "watch_duty_items"."group_id") AND "public"."current_user_can_manage_vessel"("parent"."vessel_id")))));



CREATE POLICY "Managers update checklist items" ON "public"."pre_departure_checklist_items" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."pre_departure_checklists" "parent"
  WHERE (("parent"."id" = "pre_departure_checklist_items"."checklist_id") AND "public"."current_user_can_manage_vessel"("parent"."vessel_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."pre_departure_checklists" "parent"
  WHERE (("parent"."id" = "pre_departure_checklist_items"."checklist_id") AND "public"."current_user_can_manage_vessel"("parent"."vessel_id")))));



CREATE POLICY "Managers update duty items" ON "public"."watch_duty_items" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."watch_duty_groups" "parent"
  WHERE (("parent"."id" = "watch_duty_items"."group_id") AND "public"."current_user_can_manage_vessel"("parent"."vessel_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."watch_duty_groups" "parent"
  WHERE (("parent"."id" = "watch_duty_items"."group_id") AND "public"."current_user_can_manage_vessel"("parent"."vessel_id")))));



CREATE POLICY "Members and assigned reviewers delete rest entries" ON "public"."rest_entries" FOR DELETE TO "authenticated" USING (((("user_id" = "auth"."uid"()) AND ("status" <> 'confirmed'::"text") AND "public"."current_user_can_access_vessel"("vessel_id")) OR "public"."current_user_can_manage_rest_entry"("user_id", "vessel_id")));



CREATE POLICY "Members and assigned reviewers read rest entries" ON "public"."rest_entries" FOR SELECT TO "authenticated" USING (((("user_id" = "auth"."uid"()) AND "public"."current_user_can_access_vessel"("vessel_id")) OR "public"."current_user_can_manage_rest_entry"("user_id", "vessel_id")));



CREATE POLICY "Members and assigned reviewers update rest entries" ON "public"."rest_entries" FOR UPDATE TO "authenticated" USING (((("user_id" = "auth"."uid"()) AND ("status" <> 'confirmed'::"text") AND "public"."current_user_can_access_vessel"("vessel_id")) OR "public"."current_user_can_manage_rest_entry"("user_id", "vessel_id"))) WITH CHECK (((("user_id" = "auth"."uid"()) AND ("status" <> 'confirmed'::"text") AND "public"."current_user_can_access_vessel"("vessel_id")) OR "public"."current_user_can_manage_rest_entry"("user_id", "vessel_id")));



CREATE POLICY "Members and managers create duty completions" ON "public"."watch_duty_completions" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."watch_duty_items" "duty_item"
     JOIN "public"."watch_duty_groups" "parent" ON (("parent"."id" = "duty_item"."group_id")))
  WHERE (("duty_item"."id" = "watch_duty_completions"."item_id") AND ((("watch_duty_completions"."user_id" = "auth"."uid"()) AND "public"."current_user_can_access_vessel"("parent"."vessel_id")) OR "public"."current_user_can_manage_vessel"("parent"."vessel_id"))))));



CREATE POLICY "Members and managers delete duty completions" ON "public"."watch_duty_completions" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."watch_duty_items" "duty_item"
     JOIN "public"."watch_duty_groups" "parent" ON (("parent"."id" = "duty_item"."group_id")))
  WHERE (("duty_item"."id" = "watch_duty_completions"."item_id") AND ((("watch_duty_completions"."user_id" = "auth"."uid"()) AND "public"."current_user_can_access_vessel"("parent"."vessel_id")) OR "public"."current_user_can_manage_vessel"("parent"."vessel_id"))))));



CREATE POLICY "Members and managers read duty completions" ON "public"."watch_duty_completions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."watch_duty_items" "duty_item"
     JOIN "public"."watch_duty_groups" "parent" ON (("parent"."id" = "duty_item"."group_id")))
  WHERE (("duty_item"."id" = "watch_duty_completions"."item_id") AND ((("watch_duty_completions"."user_id" = "auth"."uid"()) AND "public"."current_user_can_access_vessel"("parent"."vessel_id")) OR "public"."current_user_can_manage_vessel"("parent"."vessel_id"))))));



CREATE POLICY "Members and managers update duty completions" ON "public"."watch_duty_completions" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."watch_duty_items" "duty_item"
     JOIN "public"."watch_duty_groups" "parent" ON (("parent"."id" = "duty_item"."group_id")))
  WHERE (("duty_item"."id" = "watch_duty_completions"."item_id") AND ((("watch_duty_completions"."user_id" = "auth"."uid"()) AND "public"."current_user_can_access_vessel"("parent"."vessel_id")) OR "public"."current_user_can_manage_vessel"("parent"."vessel_id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."watch_duty_items" "duty_item"
     JOIN "public"."watch_duty_groups" "parent" ON (("parent"."id" = "duty_item"."group_id")))
  WHERE (("duty_item"."id" = "watch_duty_completions"."item_id") AND ((("watch_duty_completions"."user_id" = "auth"."uid"()) AND "public"."current_user_can_access_vessel"("parent"."vessel_id")) OR "public"."current_user_can_manage_vessel"("parent"."vessel_id"))))));



CREATE POLICY "Members can read their active vessel" ON "public"."vessels" FOR SELECT TO "authenticated" USING ("public"."current_user_can_access_vessel"("id"));



CREATE POLICY "Members can view their company" ON "public"."companies" FOR SELECT USING ((("owner_user_id" = "auth"."uid"()) OR ("id" IN ( SELECT "user_company_roles"."company_id"
   FROM "public"."user_company_roles"
  WHERE ("user_company_roles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Members create their own rest entries" ON "public"."rest_entries" FOR INSERT TO "authenticated" WITH CHECK (((("user_id" = "auth"."uid"()) AND ("status" <> 'confirmed'::"text") AND "public"."current_user_can_access_vessel"("vessel_id")) OR "public"."current_user_can_manage_rest_entry"("user_id", "vessel_id")));



CREATE POLICY "Members manage only their own notes" ON "public"."notes" TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND "public"."current_user_can_access_vessel"("vessel_id"))) WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."current_user_can_access_vessel"("vessel_id")));



CREATE POLICY "Members read checklist items" ON "public"."pre_departure_checklist_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."pre_departure_checklists" "parent"
  WHERE (("parent"."id" = "pre_departure_checklist_items"."checklist_id") AND "public"."current_user_can_access_vessel"("parent"."vessel_id")))));



CREATE POLICY "Members read duty items" ON "public"."watch_duty_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."watch_duty_groups" "parent"
  WHERE (("parent"."id" = "watch_duty_items"."group_id") AND "public"."current_user_can_access_vessel"("parent"."vessel_id")))));



CREATE POLICY "Service role only" ON "public"."deleted_users" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role only" ON "public"."expenses" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Users can create tasks" ON "public"."tasks" FOR INSERT WITH CHECK (("vessel_id" IN ( SELECT "users"."vessel_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Users can insert their own company role" ON "public"."user_company_roles" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can manage inventory categories" ON "public"."inventory_categories" USING (("vessel_id" IN ( SELECT "users"."vessel_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Users can read own profile or active vessel crew" ON "public"."users" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR (("vessel_id" IS NOT NULL) AND "public"."current_user_can_access_vessel"("vessel_id"))));



CREATE POLICY "Users can read their own devices" ON "public"."user_devices" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can read vessel inventory categories" ON "public"."inventory_categories" FOR SELECT USING (("vessel_id" IN ( SELECT "users"."vessel_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Users can read vessel tasks" ON "public"."tasks" FOR SELECT USING (("vessel_id" IN ( SELECT "users"."vessel_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Users can update tasks" ON "public"."tasks" FOR UPDATE USING (("vessel_id" IN ( SELECT "users"."vessel_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Users can view invites matching their own email" ON "public"."pending_invites" FOR SELECT USING (("lower"("email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))));



CREATE POLICY "Users can view their own company roles" ON "public"."user_company_roles" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own vessel memberships" ON "public"."user_vessel_memberships" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("vessel_id" IN ( SELECT "vessels"."id"
   FROM "public"."vessels"
  WHERE ("vessels"."management_company_id" IN ( SELECT "user_company_roles"."company_id"
           FROM "public"."user_company_roles"
          WHERE ("user_company_roles"."user_id" = "auth"."uid"())))))));



CREATE POLICY "Users create only their own unassigned profile" ON "public"."users" FOR INSERT TO "authenticated" WITH CHECK ((("id" = "auth"."uid"()) AND (("vessel_id" IS NULL) OR (NOT "public"."security_enforcement_enabled"()))));



CREATE POLICY "Users edit own profile or Captain edits vessel crew" ON "public"."users" FOR UPDATE TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."current_user_is_captain_of"("vessel_id"))) WITH CHECK ((("id" = "auth"."uid"()) OR "public"."current_captain_can_assign_profile"("vessel_id")));



CREATE POLICY "Users manage only their own signature" ON "public"."user_signatures" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users submit only their own support questions" ON "public"."user_questions" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND (("vessel_id" IS NULL) OR "public"."current_user_can_access_vessel"("vessel_id"))));



CREATE POLICY "Vessel members can read signatures used on records" ON "public"."user_signatures" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."users" "signature_owner"
  WHERE (("signature_owner"."id" = "user_signatures"."user_id") AND "public"."current_user_can_access_vessel"("signature_owner"."vessel_id"))))));



ALTER TABLE "public"."app_updates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auth_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contractors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contracts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deleted_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."department_signers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."faqs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fuel_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."general_waste_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maintenance_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."muster_stations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_subscription_purchases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pre_departure_checklist_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pre_departure_checklists" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pump_out_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rest_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rotation_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."safety_equipment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."security_enforcement_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shopping_lists" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trips" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."uniforms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_company_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_devices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_questions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_signatures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_vessel_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vessel_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vessel_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vessel_trip_colors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vessels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."watch_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."watch_duty_completions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."watch_duty_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."watch_duty_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."watch_duty_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."watch_keepers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."watch_keeping_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."watch_keeping_timetables" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."yard_period_jobs" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_crew_member"("target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_crew_member"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_crew_member"("target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_rest_entry"("entry_user_id" "uuid", "entry_vessel_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_rest_entry"("entry_user_id" "uuid", "entry_vessel_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_rest_entry"("entry_user_id" "uuid", "entry_vessel_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_view_user_signature"("target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_user_signature"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_user_signature"("target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_view_vessel_mate"("target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_vessel_mate"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_vessel_mate"("target_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_captain_vessel"("p_name" "text", "p_management_company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_captain_vessel"("p_name" "text", "p_management_company_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_captain_vessel"("p_name" "text", "p_management_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_captain_vessel"("p_name" "text", "p_management_company_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_pending_apple_purchase"("p_vessel_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_pending_apple_purchase"("p_vessel_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_pending_apple_purchase"("p_vessel_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_pending_apple_purchase"("p_vessel_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_solo_vessel_for_current_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_solo_vessel_for_current_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_solo_vessel_for_current_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_solo_vessel_for_current_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_captain_can_assign_profile"("target_vessel_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_captain_can_assign_profile"("target_vessel_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."current_captain_can_assign_profile"("target_vessel_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_captain_can_assign_profile"("target_vessel_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_session_has_device_access"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_session_has_device_access"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_session_has_device_access"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_session_has_device_access"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_can_access_vessel"("target_vessel_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_can_access_vessel"("target_vessel_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_can_access_vessel"("target_vessel_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_can_access_vessel"("target_vessel_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_can_access_vessel_storage_path"("p_vessel_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_can_access_vessel_storage_path"("p_vessel_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_can_access_vessel_storage_path"("p_vessel_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_can_manage_rest_entry"("target_user_id" "uuid", "target_vessel_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_can_manage_rest_entry"("target_user_id" "uuid", "target_vessel_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_can_manage_rest_entry"("target_user_id" "uuid", "target_vessel_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_can_manage_rest_entry"("target_user_id" "uuid", "target_vessel_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_can_manage_vessel"("target_vessel_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_can_manage_vessel"("target_vessel_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_can_manage_vessel"("target_vessel_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_can_manage_vessel"("target_vessel_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_is_captain_for_storage_path"("p_vessel_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_is_captain_for_storage_path"("p_vessel_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_is_captain_for_storage_path"("p_vessel_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_is_captain_of"("target_vessel_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_is_captain_of"("target_vessel_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_is_captain_of"("target_vessel_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_is_captain_of"("target_vessel_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_vessel_invite_code"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_vessel_invite_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_vessel_invite_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_vessel_invite_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_company_vessel_ids"("uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_company_vessel_ids"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_company_vessel_ids"("uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_vessel_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_vessel_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_vessel_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_vessel_subscription_entitlement"("p_vessel_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_vessel_subscription_entitlement"("p_vessel_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_vessel_subscription_entitlement"("p_vessel_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_vessel_subscription_entitlement"("p_vessel_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_vessel_hod_or_captain"("target_vessel_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_vessel_hod_or_captain"("target_vessel_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_vessel_hod_or_captain"("target_vessel_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_vessel_hod_or_captain"("target_vessel_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_current_user_to_vessel"("p_invite_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_current_user_to_vessel"("p_invite_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."join_current_user_to_vessel"("p_invite_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_current_user_to_vessel"("p_invite_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_user_security_fields"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_user_security_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_user_security_fields"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."regenerate_current_vessel_invite_code"("p_vessel_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."regenerate_current_vessel_invite_code"("p_vessel_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."regenerate_current_vessel_invite_code"("p_vessel_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."regenerate_current_vessel_invite_code"("p_vessel_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_user_device"("p_device_fingerprint" "text", "p_platform" "text", "p_device_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_user_device"("p_device_fingerprint" "text", "p_platform" "text", "p_device_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."register_user_device"("p_device_fingerprint" "text", "p_platform" "text", "p_device_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_user_device"("p_device_fingerprint" "text", "p_platform" "text", "p_device_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_current_device"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_current_device"() TO "anon";
GRANT ALL ON FUNCTION "public"."revoke_current_device"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."revoke_current_device"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."security_enforcement_enabled"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."security_enforcement_enabled"() TO "anon";
GRANT ALL ON FUNCTION "public"."security_enforcement_enabled"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."security_enforcement_enabled"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_vessel_invite_code"("p_invite_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_vessel_invite_code"("p_invite_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."validate_vessel_invite_code"("p_invite_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_vessel_invite_code"("p_invite_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."vessel_subscription_allows_access"("target_vessel_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."vessel_subscription_allows_access"("target_vessel_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."vessel_subscription_allows_access"("target_vessel_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vessel_subscription_allows_access"("target_vessel_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."app_updates" TO "anon";
GRANT ALL ON TABLE "public"."app_updates" TO "authenticated";
GRANT ALL ON TABLE "public"."app_updates" TO "service_role";



GRANT ALL ON TABLE "public"."auth_links" TO "anon";
GRANT ALL ON TABLE "public"."auth_links" TO "authenticated";
GRANT ALL ON TABLE "public"."auth_links" TO "service_role";



GRANT ALL ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT ALL ON TABLE "public"."contractors" TO "anon";
GRANT ALL ON TABLE "public"."contractors" TO "authenticated";
GRANT ALL ON TABLE "public"."contractors" TO "service_role";



GRANT ALL ON TABLE "public"."contracts" TO "anon";
GRANT ALL ON TABLE "public"."contracts" TO "authenticated";
GRANT ALL ON TABLE "public"."contracts" TO "service_role";



GRANT ALL ON TABLE "public"."deleted_users" TO "anon";
GRANT ALL ON TABLE "public"."deleted_users" TO "authenticated";
GRANT ALL ON TABLE "public"."deleted_users" TO "service_role";



GRANT ALL ON TABLE "public"."department_signers" TO "anon";
GRANT ALL ON TABLE "public"."department_signers" TO "authenticated";
GRANT ALL ON TABLE "public"."department_signers" TO "service_role";



GRANT ALL ON TABLE "public"."expenses" TO "anon";
GRANT ALL ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT ALL ON TABLE "public"."faqs" TO "anon";
GRANT ALL ON TABLE "public"."faqs" TO "authenticated";
GRANT ALL ON TABLE "public"."faqs" TO "service_role";



GRANT ALL ON TABLE "public"."fuel_logs" TO "anon";
GRANT ALL ON TABLE "public"."fuel_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."fuel_logs" TO "service_role";



GRANT ALL ON TABLE "public"."general_waste_logs" TO "anon";
GRANT ALL ON TABLE "public"."general_waste_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."general_waste_logs" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_categories" TO "anon";
GRANT ALL ON TABLE "public"."inventory_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_categories" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_items" TO "anon";
GRANT ALL ON TABLE "public"."inventory_items" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_items" TO "service_role";



GRANT ALL ON TABLE "public"."maintenance_logs" TO "anon";
GRANT ALL ON TABLE "public"."maintenance_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."maintenance_logs" TO "service_role";



GRANT ALL ON TABLE "public"."muster_stations" TO "anon";
GRANT ALL ON TABLE "public"."muster_stations" TO "authenticated";
GRANT ALL ON TABLE "public"."muster_stations" TO "service_role";



GRANT ALL ON TABLE "public"."notes" TO "anon";
GRANT ALL ON TABLE "public"."notes" TO "authenticated";
GRANT ALL ON TABLE "public"."notes" TO "service_role";



GRANT ALL ON TABLE "public"."pending_invites" TO "anon";
GRANT ALL ON TABLE "public"."pending_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."pending_invites" TO "service_role";



GRANT ALL ON TABLE "public"."pending_subscription_purchases" TO "service_role";



GRANT ALL ON TABLE "public"."pre_departure_checklist_items" TO "anon";
GRANT ALL ON TABLE "public"."pre_departure_checklist_items" TO "authenticated";
GRANT ALL ON TABLE "public"."pre_departure_checklist_items" TO "service_role";



GRANT ALL ON TABLE "public"."pre_departure_checklists" TO "anon";
GRANT ALL ON TABLE "public"."pre_departure_checklists" TO "authenticated";
GRANT ALL ON TABLE "public"."pre_departure_checklists" TO "service_role";



GRANT ALL ON TABLE "public"."pump_out_logs" TO "anon";
GRANT ALL ON TABLE "public"."pump_out_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."pump_out_logs" TO "service_role";



GRANT ALL ON TABLE "public"."rest_entries" TO "anon";
GRANT ALL ON TABLE "public"."rest_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."rest_entries" TO "service_role";



GRANT ALL ON TABLE "public"."rotation_groups" TO "anon";
GRANT ALL ON TABLE "public"."rotation_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."rotation_groups" TO "service_role";



GRANT ALL ON TABLE "public"."rules" TO "anon";
GRANT ALL ON TABLE "public"."rules" TO "authenticated";
GRANT ALL ON TABLE "public"."rules" TO "service_role";



GRANT ALL ON TABLE "public"."safety_equipment" TO "anon";
GRANT ALL ON TABLE "public"."safety_equipment" TO "authenticated";
GRANT ALL ON TABLE "public"."safety_equipment" TO "service_role";



GRANT ALL ON TABLE "public"."security_enforcement_settings" TO "service_role";



GRANT ALL ON TABLE "public"."shopping_lists" TO "anon";
GRANT ALL ON TABLE "public"."shopping_lists" TO "authenticated";
GRANT ALL ON TABLE "public"."shopping_lists" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON TABLE "public"."trips" TO "anon";
GRANT ALL ON TABLE "public"."trips" TO "authenticated";
GRANT ALL ON TABLE "public"."trips" TO "service_role";



GRANT ALL ON TABLE "public"."uniforms" TO "anon";
GRANT ALL ON TABLE "public"."uniforms" TO "authenticated";
GRANT ALL ON TABLE "public"."uniforms" TO "service_role";



GRANT ALL ON TABLE "public"."user_company_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_company_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_company_roles" TO "service_role";



GRANT ALL ON TABLE "public"."user_devices" TO "anon";
GRANT ALL ON TABLE "public"."user_devices" TO "authenticated";
GRANT ALL ON TABLE "public"."user_devices" TO "service_role";



GRANT ALL ON TABLE "public"."user_questions" TO "anon";
GRANT ALL ON TABLE "public"."user_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_questions" TO "service_role";



GRANT ALL ON TABLE "public"."user_signatures" TO "anon";
GRANT ALL ON TABLE "public"."user_signatures" TO "authenticated";
GRANT ALL ON TABLE "public"."user_signatures" TO "service_role";



GRANT ALL ON TABLE "public"."user_vessel_memberships" TO "anon";
GRANT ALL ON TABLE "public"."user_vessel_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."user_vessel_memberships" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."vessel_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."vessel_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."vessel_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."vessel_tasks" TO "anon";
GRANT ALL ON TABLE "public"."vessel_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."vessel_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."vessel_trip_colors" TO "anon";
GRANT ALL ON TABLE "public"."vessel_trip_colors" TO "authenticated";
GRANT ALL ON TABLE "public"."vessel_trip_colors" TO "service_role";



GRANT ALL ON TABLE "public"."vessels" TO "anon";
GRANT ALL ON TABLE "public"."vessels" TO "authenticated";
GRANT ALL ON TABLE "public"."vessels" TO "service_role";



GRANT ALL ON TABLE "public"."watch_assignments" TO "anon";
GRANT ALL ON TABLE "public"."watch_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."watch_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."watch_duty_completions" TO "anon";
GRANT ALL ON TABLE "public"."watch_duty_completions" TO "authenticated";
GRANT ALL ON TABLE "public"."watch_duty_completions" TO "service_role";



GRANT ALL ON TABLE "public"."watch_duty_groups" TO "anon";
GRANT ALL ON TABLE "public"."watch_duty_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."watch_duty_groups" TO "service_role";



GRANT ALL ON TABLE "public"."watch_duty_items" TO "anon";
GRANT ALL ON TABLE "public"."watch_duty_items" TO "authenticated";
GRANT ALL ON TABLE "public"."watch_duty_items" TO "service_role";



GRANT ALL ON TABLE "public"."watch_duty_rules" TO "anon";
GRANT ALL ON TABLE "public"."watch_duty_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."watch_duty_rules" TO "service_role";



GRANT ALL ON TABLE "public"."watch_keepers" TO "anon";
GRANT ALL ON TABLE "public"."watch_keepers" TO "authenticated";
GRANT ALL ON TABLE "public"."watch_keepers" TO "service_role";



GRANT ALL ON TABLE "public"."watch_keeping_rules" TO "anon";
GRANT ALL ON TABLE "public"."watch_keeping_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."watch_keeping_rules" TO "service_role";



GRANT ALL ON TABLE "public"."watch_keeping_timetables" TO "anon";
GRANT ALL ON TABLE "public"."watch_keeping_timetables" TO "authenticated";
GRANT ALL ON TABLE "public"."watch_keeping_timetables" TO "service_role";



GRANT ALL ON TABLE "public"."yard_period_jobs" TO "anon";
GRANT ALL ON TABLE "public"."yard_period_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."yard_period_jobs" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
