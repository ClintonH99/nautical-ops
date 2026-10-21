-- Only Captain/MOV may manage other users' Hours of Rest. Existing RLS policies
-- call this helper for SELECT/INSERT/UPDATE/DELETE; owner access is unchanged.
-- Keep historical signer assignments and confirmation records, but remove all
-- authorization derived from those assignments (including old installed clients).
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
  SELECT public.current_user_is_captain_of(target_vessel_id);
$$;

REVOKE ALL ON FUNCTION public.current_user_can_manage_rest_entry(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_rest_entry(UUID, UUID) TO authenticated;

-- Retain rows for history, but stop obsolete clients assigning new approvers.
REVOKE INSERT, UPDATE, DELETE ON public.department_signers FROM authenticated;

NOTIFY pgrst, 'reload schema';
