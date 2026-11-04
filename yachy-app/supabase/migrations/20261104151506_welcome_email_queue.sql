-- Future first-vessel welcomes only. No backfill, subscription changes or mail
-- at migration time. Enable only after both function deployments are verified.
BEGIN;
CREATE TABLE public.welcome_email_runtime (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.welcome_email_runtime DEFAULT VALUES;
CREATE TABLE public.welcome_email_jobs (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('captain','crew_solo','crew_joined')),
  recipient jsonb NOT NULL,
  vessel_name text NOT NULL,
  message jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','review','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  first_attempt_at timestamptz,
  provider_id text,
  accepted_at timestamptz,
  last_result text,
  delivery_state text NOT NULL DEFAULT 'unknown' CHECK(delivery_state IN
    ('unknown','sent','delivered','delivery_delayed','bounced','complained','failed','suppressed','opened','clicked')),
  delivery_checked_at timestamptz,
  delivery_checks integer NOT NULL DEFAULT 0
);
CREATE INDEX welcome_email_jobs_due ON public.welcome_email_jobs(available_at)
  WHERE status IN ('pending','accepted');
ALTER TABLE public.welcome_email_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welcome_email_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.welcome_email_runtime,public.welcome_email_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.welcome_email_runtime,public.welcome_email_jobs TO service_role;

CREATE FUNCTION public.wake_welcome_email_worker() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.welcome_email_runtime WHERE id AND enabled) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.welcome_email_jobs WHERE available_at <= now()
      AND (lease_until IS NULL OR lease_until < now())
      AND (status='pending' OR (status='accepted' AND delivery_checks < 12
        AND delivery_state IN ('unknown','sent','delivery_delayed')))) THEN RETURN; END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets
    WHERE name='notification_worker_secret' LIMIT 1;
  IF secret IS NULL OR length(secret)<32 THEN RAISE EXCEPTION 'Notification credential unavailable'; END IF;
  PERFORM net.http_post(
    url:='https://grtrcjgsvfsknpnlarxv.supabase.co/functions/v1/process-welcome-emails',
    headers:=jsonb_build_object('Content-Type','application/json','x-trip-webhook-secret',secret),
    body:='{}'::jsonb,timeout_milliseconds:=5000);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Welcome email wake failed; scheduled retry remains available';
END;
$$;
REVOKE ALL ON FUNCTION public.wake_welcome_email_worker() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wake_welcome_email_worker() TO service_role;

CREATE FUNCTION public.enqueue_welcome_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_name text; v_solo boolean;
BEGIN
  IF NEW.vessel_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.welcome_email_runtime WHERE id AND enabled)
    THEN RETURN NULL; END IF;
  IF TG_OP='UPDATE' AND OLD.vessel_id IS NOT NULL THEN RETURN NULL; END IF;
  SELECT name,is_solo INTO v_name,v_solo FROM public.vessels WHERE id=NEW.vessel_id;
  INSERT INTO public.welcome_email_jobs(user_id,kind,recipient,vessel_name)
    VALUES(NEW.id,CASE WHEN NEW.role='CAPTAIN_MOV' THEN 'captain'
      WHEN v_solo THEN 'crew_solo' ELSE 'crew_joined' END,
      jsonb_build_object('email',NEW.email,'name',NEW.name),coalesce(v_name,'your vessel'))
    ON CONFLICT(user_id) DO NOTHING;
  PERFORM public.wake_welcome_email_worker();
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_welcome_email() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER welcome_email_enqueue AFTER INSERT OR UPDATE OF vessel_id ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_welcome_email();

CREATE FUNCTION public.claim_welcome_email_jobs() RETURNS SETOF public.welcome_email_jobs
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  UPDATE public.welcome_email_jobs SET lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',
    attempts=attempts+CASE WHEN status='pending' THEN 1 ELSE 0 END,
    delivery_checks=delivery_checks+CASE WHEN status='accepted' THEN 1 ELSE 0 END
  WHERE user_id IN (
    SELECT user_id FROM public.welcome_email_jobs
    WHERE available_at<=now() AND (lease_until IS NULL OR lease_until<now())
      AND (status='pending' OR (status='accepted' AND delivery_checks<12
        AND delivery_state IN ('unknown','sent','delivery_delayed')))
      AND EXISTS (SELECT 1 FROM public.welcome_email_runtime WHERE id AND enabled)
    ORDER BY available_at LIMIT 2 FOR UPDATE SKIP LOCKED
  ) RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.claim_welcome_email_jobs() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_welcome_email_jobs() TO service_role;
SELECT cron.schedule('nautical-welcome-emails','* * * * *','select public.wake_welcome_email_worker()');
COMMIT;
