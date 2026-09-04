-- Make QR web sign-in claims and one-time consumption atomic. These functions
-- are callable only by Edge Functions using the service-role key.

CREATE OR REPLACE FUNCTION public.admin_claim_auth_link(
  p_code TEXT,
  p_action_link TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claimed_code TEXT;
BEGIN
  UPDATE public.auth_links
  SET action_link = p_action_link
  WHERE code = p_code
    AND action_link IS NULL
    AND expires_at > now()
  RETURNING code INTO claimed_code;

  RETURN claimed_code IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_claim_auth_link(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_claim_auth_link(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_consume_auth_link(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  auth_link public.auth_links%ROWTYPE;
BEGIN
  SELECT * INTO auth_link
  FROM public.auth_links
  WHERE code = p_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'pending');
  END IF;

  IF auth_link.expires_at <= now() THEN
    DELETE FROM public.auth_links WHERE code = p_code;
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF auth_link.action_link IS NULL OR btrim(auth_link.action_link) = '' THEN
    RETURN jsonb_build_object('status', 'pending');
  END IF;

  DELETE FROM public.auth_links WHERE code = p_code;
  RETURN jsonb_build_object(
    'status', 'ready',
    'action_link', btrim(auth_link.action_link)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_consume_auth_link(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_consume_auth_link(TEXT) TO service_role;
