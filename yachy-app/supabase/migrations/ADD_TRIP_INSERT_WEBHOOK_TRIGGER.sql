-- Trigger: Send push notification when a trip is inserted
-- This replaces the need to create a Database Webhook in the Dashboard.
-- Run this in Supabase SQL Editor.
--
-- BEFORE RUNNING:
-- 1. Enable pg_net: Dashboard → Database → Extensions → pg_net → Enable
-- 2. Replace YOUR_ANON_KEY with your anon key from Dashboard → Settings → API → anon public

-- Function to call Edge Function when trip is inserted
CREATE OR REPLACE FUNCTION public.notify_trip_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  payload jsonb;
  edge_url text := 'https://grtrcjgsvfsknpnlarxv.supabase.co/functions/v1/send-trip-push';
  anon_key text := 'YOUR_ANON_KEY';
BEGIN
  payload := jsonb_build_object(
    'type', 'INSERT',
    'table', 'trips',
    'schema', 'public',
    'record', to_jsonb(NEW),
    'old_record', NULL
  );

  PERFORM net.http_post(
    url := edge_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    body := payload
  );

  RETURN NEW;
END;
$$;

-- Drop trigger if it exists (for re-running migration)
DROP TRIGGER IF EXISTS trip_insert_push_notify ON public.trips;

-- Create trigger
CREATE TRIGGER trip_insert_push_notify
  AFTER INSERT ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_trip_insert();

COMMENT ON FUNCTION public.notify_trip_insert() IS 'Calls send-trip-push Edge Function to notify crew when a trip is created';
