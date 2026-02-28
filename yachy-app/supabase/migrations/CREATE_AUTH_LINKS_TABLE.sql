-- Auth links for QR sign-in: link website session by scanning with app
CREATE TABLE IF NOT EXISTS public.auth_links (
  code TEXT PRIMARY KEY,
  action_link TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.auth_links ENABLE ROW LEVEL SECURITY;

-- Only service role / Edge Functions will write; no direct client access needed
-- (Edge Functions use service role)
