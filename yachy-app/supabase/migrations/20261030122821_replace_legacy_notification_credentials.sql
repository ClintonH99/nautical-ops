-- Credential recovery only: preserve existing events/payloads, remove embedded
-- revoked database credentials. Uses the existing notification-only Vault secret.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'notification_worker_secret' AND length(decrypted_secret) >= 32) THEN
    RAISE EXCEPTION 'Notification-only credential is not configured';
  END IF;
  IF to_regprocedure('public.send_notification_webhook_with_vault()') IS NOT NULL THEN
    RAISE EXCEPTION 'Recovery function already exists; inspect before retrying';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace
        AND p.pronamespace='supabase_functions'::regnamespace
        AND p.proname='http_request' AND t.tgenabled='O' AND t.tgqual IS NULL
        AND t.tgnargs=5 AND (
          (c.relname='trips' AND t.tgname='Trip created → push' AND t.tgtype=5
            AND position('https://grtrcjgsvfsknpnlarxv.supabase.co/functions/v1/send-trip-push' in encode(t.tgargs,'escape'))=1)
          OR (c.relname IN ('users','vessel_subscriptions') AND t.tgname=c.relname AND t.tgtype=21
            AND position('https://grtrcjgsvfsknpnlarxv.supabase.co/functions/v1/send-welcome-email' in encode(t.tgargs,'escape'))=1)
        )) <> 3 THEN
    RAISE EXCEPTION 'Notification trigger configuration changed; recovery stopped';
  END IF;
END;
$$;

CREATE FUNCTION public.send_notification_webhook_with_vault() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  notification_secret text;
  endpoint text;
  payload jsonb;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' THEN RAISE EXCEPTION 'Unsupported notification schema'; END IF;
  IF TG_TABLE_NAME = 'trips' AND TG_OP = 'INSERT' THEN
    endpoint := 'https://grtrcjgsvfsknpnlarxv.supabase.co/functions/v1/send-trip-push';
  ELSIF TG_TABLE_NAME IN ('users','vessel_subscriptions') AND TG_OP IN ('INSERT','UPDATE') THEN
    endpoint := 'https://grtrcjgsvfsknpnlarxv.supabase.co/functions/v1/send-welcome-email';
  ELSE
    RAISE EXCEPTION 'Unsupported notification event';
  END IF;
  SELECT decrypted_secret INTO notification_secret FROM vault.decrypted_secrets
    WHERE name = 'notification_worker_secret' LIMIT 1;
  IF notification_secret IS NULL OR length(notification_secret) < 32 THEN
    RAISE EXCEPTION 'Notification credential unavailable';
  END IF;
  payload := jsonb_build_object('type', TG_OP, 'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA, 'record', to_jsonb(NEW),
    'old_record', CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END);
  PERFORM net.http_post(url := endpoint,
    headers := jsonb_build_object('Content-Type','application/json','x-trip-webhook-secret',notification_secret),
    body := payload, timeout_milliseconds := 5000);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Notification delivery must not undo a saved account, trip or subscription.
  -- Never log payloads, headers, or exception text containing credentials.
  RAISE WARNING 'Notification webhook dispatch failed';
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.send_notification_webhook_with_vault() FROM PUBLIC, anon, authenticated;

DROP TRIGGER "Trip created → push" ON public.trips;
CREATE TRIGGER "Trip created → push" AFTER INSERT ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.send_notification_webhook_with_vault();
DROP TRIGGER users ON public.users;
CREATE TRIGGER users AFTER INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.send_notification_webhook_with_vault();
DROP TRIGGER vessel_subscriptions ON public.vessel_subscriptions;
CREATE TRIGGER vessel_subscriptions AFTER INSERT OR UPDATE ON public.vessel_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.send_notification_webhook_with_vault();
COMMIT;
