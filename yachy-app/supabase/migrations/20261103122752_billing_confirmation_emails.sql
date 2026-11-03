-- Email-only queue: never updates billing, access, users, prices or payments.
BEGIN;
CREATE TABLE public.billing_email_runtime (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.billing_email_runtime DEFAULT VALUES;
CREATE TABLE public.billing_email_jobs (
  subscription_id text PRIMARY KEY REFERENCES public.paddle_subscription_links(subscription_id),
  not_before timestamptz NOT NULL DEFAULT (now() - interval '1 hour'),
  requested_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_result text,
  CHECK (subscription_id ~ '^sub_[a-z0-9]{26}$')
);
CREATE INDEX billing_email_jobs_due ON public.billing_email_jobs(available_at);
CREATE TABLE public.billing_email_deliveries (
  email_key text PRIMARY KEY CHECK (length(email_key) <= 256),
  subscription_id text NOT NULL REFERENCES public.paddle_subscription_links(subscription_id),
  recipient_id uuid NOT NULL REFERENCES public.users(id),
  kind text NOT NULL CHECK (kind IN ('trial','billing','paid','active')),
  message jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','review')),
  first_attempt_at timestamptz,
  provider_id text,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_email_deliveries_subscription ON public.billing_email_deliveries(subscription_id);
ALTER TABLE public.billing_email_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_email_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_email_runtime,public.billing_email_jobs,public.billing_email_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.billing_email_runtime,public.billing_email_jobs,public.billing_email_deliveries TO service_role;

-- This definer is trigger/cron-only, not callable by app clients. The existing
-- dedicated notification credential stays inside Vault and HTTP headers.
CREATE FUNCTION public.wake_billing_email_worker() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.billing_email_runtime WHERE id AND enabled) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_email_jobs WHERE available_at <= now() AND attempts < 12 AND (lease_until IS NULL OR lease_until < now())) THEN RETURN; END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='notification_worker_secret' LIMIT 1;
  IF length(secret) < 32 OR secret IS NULL THEN RAISE EXCEPTION 'Notification credential unavailable'; END IF;
  PERFORM net.http_post(
    url:='https://grtrcjgsvfsknpnlarxv.supabase.co/functions/v1/process-billing-emails',
    headers:=jsonb_build_object('Content-Type','application/json','x-trip-webhook-secret',secret),
    body:='{}'::jsonb,timeout_milliseconds:=5000);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Billing email wake failed';
END;
$$;
REVOKE ALL ON FUNCTION public.wake_billing_email_worker() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wake_billing_email_worker() TO service_role;

CREATE FUNCTION public.enqueue_billing_email_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.payment_provider <> 'paddle' OR NEW.paddle_subscription_id IS NULL OR
     NOT EXISTS (SELECT 1 FROM public.billing_email_runtime WHERE id AND enabled) OR
     NOT EXISTS (SELECT 1 FROM public.paddle_subscription_links WHERE subscription_id=NEW.paddle_subscription_id AND environment='live' AND vessel_id=NEW.vessel_id) THEN RETURN NULL; END IF;
  INSERT INTO public.billing_email_jobs(subscription_id) VALUES(NEW.paddle_subscription_id)
    ON CONFLICT(subscription_id) DO UPDATE SET requested_at=now(),available_at=now(),attempts=0;
  PERFORM public.wake_billing_email_worker();
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Email must never undo a subscription webhook. Failure is visible in logs.
  RAISE WARNING 'Billing email enqueue failed';
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_billing_email_check() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER billing_email_check AFTER INSERT OR UPDATE ON public.vessel_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_billing_email_check();

CREATE FUNCTION public.claim_billing_email_jobs() RETURNS SETOF public.billing_email_jobs
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  UPDATE public.billing_email_jobs SET lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
  WHERE subscription_id IN (
    SELECT subscription_id FROM public.billing_email_jobs
    WHERE available_at <= now() AND (lease_until IS NULL OR lease_until < now()) AND attempts < 12
      AND EXISTS (SELECT 1 FROM public.billing_email_runtime WHERE id AND enabled)
    ORDER BY available_at LIMIT 2 FOR UPDATE SKIP LOCKED
  ) RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.claim_billing_email_jobs() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_billing_email_jobs() TO service_role;

-- No backfill or mail at migration time. Activation is a separate verified step.
SELECT cron.schedule('nautical-billing-emails','*/5 * * * *','select public.wake_billing_email_worker()');
COMMIT;
