-- MANUAL RELEASE STEP ONLY. Do not run until the functions and app are approved.
-- Release order, once deployment is explicitly approved:
-- 1. Apply 20261001120000_RELIABLE_NOTIFICATION_QUEUE.sql (capture stays OFF).
-- 2. Deploy process-notifications with --no-verify-jwt. It independently checks
--    NOTIFICATION_WORKER_SECRET/service-role authentication; never expose either secret.
-- 3. Deploy the updated send-trip-push BEFORE enabling this queue. It stops its
--    legacy direct sends when notification_runtime.enabled is true, avoiding
--    duplicate sends from existing trip/checklist hooks and older Crew Leave apps.
-- 4. Configure Vault below and verify the worker rejects unauthenticated requests.
-- 5. Run this activation transaction, then verify cron and pg_net responses.
-- 6. Install/test the approved native build. No EAS build/submit is run here.
-- Keep existing hooks during rollout. Rollback queue mode with
-- UPDATE public.notification_runtime SET enabled = false WHERE id = true;
-- This restores the legacy sender paths; new notification categories pause.
-- Schema must precede the new app, whose explicit ON action uses a new RPC.
-- Vault must contain notification_worker_url (the process-notifications URL)
-- and notification_worker_secret (same value as Edge NOTIFICATION_WORKER_SECRET).
-- This dedicated secret does not rotate the existing trip webhook credentials.
-- Do not place real secret values in this file or in source control.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name = 'notification_worker_url' AND decrypted_secret LIKE 'https://%/functions/v1/process-notifications')
    OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name = 'notification_worker_secret' AND length(decrypted_secret) >= 32) THEN
    RAISE EXCEPTION 'Configure notification worker URL and secret in Vault before activation';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.wake_notification_worker() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE url TEXT; secret TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.notification_runtime WHERE enabled) THEN RETURN; END IF;
  SELECT decrypted_secret INTO url FROM vault.decrypted_secrets WHERE name = 'notification_worker_url' LIMIT 1;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'notification_worker_secret' LIMIT 1;
  IF url IS NULL OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(url := url, headers := jsonb_build_object('Content-Type','application/json','x-trip-webhook-secret',secret),body := '{}'::JSONB,timeout_milliseconds := 55000);
EXCEPTION WHEN OTHERS THEN
  -- A temporary wake-up failure must not undo the saved operational record.
  -- The next cron tick processes the durable queue.
  RAISE WARNING 'Notification wake-up failed; queue retained';
END;
$$;
REVOKE ALL ON FUNCTION public.wake_notification_worker() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.wake_notification_worker_after_write() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN PERFORM public.wake_notification_worker(); RETURN NULL; END;
$$;
REVOKE ALL ON FUNCTION public.wake_notification_worker_after_write() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE tbl TEXT; BEGIN
  FOREACH tbl IN ARRAY ARRAY['crew_leave','vessel_tasks','yard_period_jobs','maintenance_logs','watch_keeping_timetables','trips','pre_departure_checklists'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS wake_notification_worker ON public.%I',tbl);
    EXECUTE format('CREATE TRIGGER wake_notification_worker AFTER INSERT OR UPDATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.wake_notification_worker_after_write()',tbl);
  END LOOP;
END $$;
SELECT cron.schedule('nautical-notification-delivery','* * * * *','SELECT public.wake_notification_worker()');
UPDATE public.notification_runtime SET enabled = true WHERE id;
COMMIT;
