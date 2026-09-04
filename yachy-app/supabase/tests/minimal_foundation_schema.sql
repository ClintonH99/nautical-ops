-- Minimal disposable schema used to exercise security-sensitive migrations in
-- an isolated PostgreSQL container. This file is not a production migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.vessels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  invite_expiry TIMESTAMPTZ,
  is_solo BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE public.users (
  id UUID PRIMARY KEY,
  vessel_id UUID REFERENCES public.vessels(id),
  role TEXT NOT NULL,
  vessel_joined_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.vessel_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  plan_tier TEXT,
  billing_period TEXT,
  status TEXT,
  paddle_subscription_id TEXT,
  payment_provider TEXT,
  apple_original_transaction_id TEXT UNIQUE,
  apple_latest_transaction_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  grace_period_end TIMESTAMPTZ,
  billing_retry_started_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX vessel_subscriptions_vessel_id_key
  ON public.vessel_subscriptions(vessel_id);

CREATE TABLE public.pending_subscription_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '1 day',
  consumed_at TIMESTAMPTZ
);

CREATE TABLE public.auth_links (
  code TEXT PRIMARY KEY,
  action_link TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE SEQUENCE public.test_invite_code_sequence;
CREATE OR REPLACE FUNCTION public.generate_vessel_invite_code()
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT 'TEST' || lpad(nextval('public.test_invite_code_sequence')::TEXT, 8, '0');
$$;
