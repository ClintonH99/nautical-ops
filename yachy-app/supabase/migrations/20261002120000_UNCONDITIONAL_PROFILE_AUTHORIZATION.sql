-- Authorization fields must never depend on the device-enforcement rollout.
-- Leave security_enforcement_settings unchanged: enabling device enforcement
-- is a separate rollout requiring browser recovery/compatibility verification.

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
  -- Service/database maintenance and explicitly authorized transition RPCs
  -- retain their existing path. Ordinary API users cannot set this flag.
  IF auth.uid() IS NULL OR trusted_change THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.id IS DISTINCT FROM auth.uid()
      OR NEW.vessel_id IS NOT NULL
      OR NEW.role IS NULL
      OR NEW.role NOT IN ('CREW', 'CAPTAIN_MOV') THEN
      RAISE EXCEPTION 'User profile security fields must be assigned by the server';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'User identity fields cannot be changed through the profile API';
  END IF;

  -- Joining, removing and moving accounts must use the protected transition
  -- RPCs (which also preserve records, validate invitations and reset roles).
  IF NEW.vessel_id IS DISTINCT FROM OLD.vessel_id THEN
    RAISE EXCEPTION 'Vessel membership must be changed through the authorized vessel actions';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
    AND (NEW.role IS NULL OR NEW.role NOT IN ('CREW', 'HOD', 'CAPTAIN_MOV')) THEN
    RAISE EXCEPTION 'Invalid vessel role';
  END IF;

  IF NEW.role IS NOT DISTINCT FROM OLD.role
    AND NEW.contract_type IS NOT DISTINCT FROM OLD.contract_type
    AND NEW.rotation_group_id IS NOT DISTINCT FROM OLD.rotation_group_id THEN
    RETURN NEW;
  END IF;

  IF NEW.id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role or vessel membership';
  END IF;

  SELECT role, vessel_id INTO actor_role, actor_vessel_id
  FROM public.users WHERE id = auth.uid();

  IF actor_role IS DISTINCT FROM 'CAPTAIN_MOV'
    OR actor_vessel_id IS NULL
    OR OLD.vessel_id IS DISTINCT FROM actor_vessel_id
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

-- Trigger invocation does not need a public RPC execution grant.
REVOKE ALL ON FUNCTION public.protect_user_security_fields() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Users create only their own unassigned profile" ON public.users;
CREATE POLICY "Users create only their own unassigned profile"
ON public.users FOR INSERT TO authenticated
WITH CHECK (
  id = auth.uid()
  AND vessel_id IS NULL
  AND role IN ('CREW', 'CAPTAIN_MOV')
);

COMMENT ON FUNCTION public.protect_user_security_fields() IS
  'Always protects identity, role and vessel membership, independently of device-enforcement rollout settings.';
