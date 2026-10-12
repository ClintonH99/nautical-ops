-- Admin-only, read-only contact review approved on 2026-10-12.
-- Already created manually in production; OR REPLACE allows migration replay.
-- This migration does not delete or modify any vessel or user records.
BEGIN;

CREATE OR REPLACE VIEW public.admin_vessel_contact_review
WITH (security_invoker = true, security_barrier = true) AS
SELECT
  v.name AS vessel_name,
  string_agg(
    concat(coalesce(nullif(btrim(u.name), ''), '(no name)'), ' <', coalesce(u.email, '(no email)'), '>'),
    E'\n' ORDER BY u.name, u.id
  ) FILTER (WHERE u.role::text = 'CAPTAIN_MOV') AS current_captain_contacts,
  string_agg(
    concat(coalesce(nullif(btrim(u.name), ''), '(no name)'), ' <', coalesce(u.email, '(no email)'), '> [', coalesce(u.role::text, 'unknown'), ']'),
    E'\n' ORDER BY u.name, u.id
  ) FILTER (WHERE u.id IS NOT NULL AND u.role::text IS DISTINCT FROM 'CAPTAIN_MOV') AS current_crew_contacts,
  v.id AS vessel_id,
  v.created_at AS vessel_created_at,
  count(u.id) AS current_member_count_including_captains,
  CASE WHEN v.is_solo THEN 'Personal workspace' ELSE 'Vessel' END AS workspace_type,
  coalesce(jsonb_agg(jsonb_build_object('user_id', u.id, 'name', u.name, 'email', u.email, 'role', u.role) ORDER BY u.name, u.id)
    FILTER (WHERE u.id IS NOT NULL), '[]'::jsonb) AS current_members
FROM public.vessels v
LEFT JOIN public.users u ON u.vessel_id = v.id
GROUP BY v.id, v.name, v.created_at, v.is_solo;

-- Revoke default API grants in the same transaction as creation.
-- Administrative review is through the database owner, not app API roles.
REVOKE ALL ON public.admin_vessel_contact_review FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON VIEW public.admin_vessel_contact_review IS
  'Admin-only read-only cleanup review. Contacts reflect current users.vessel_id membership, NOT the original vessel creator. No creator attribution is inferred. Member count includes captains and HODs. Missing contacts do not mean a vessel is safe to delete.';

COMMIT;
