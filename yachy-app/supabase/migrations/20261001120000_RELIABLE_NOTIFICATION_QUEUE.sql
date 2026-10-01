-- Staged only: capture/delivery remains disabled until the explicit activation
-- script is run. No change to operational CRUD permissions or calculations.
BEGIN;

ALTER TABLE public.user_devices ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.set_current_device_push_token(p_device_fingerprint TEXT, p_expo_push_token TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE device public.user_devices%ROWTYPE; token TEXT := trim(p_expo_push_token);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_device_fingerprint IS NULL OR length(trim(p_device_fingerprint)) < 16
    OR token IS NULL OR length(token) > 512
    OR (token NOT LIKE 'ExponentPushToken[%]' AND token NOT LIKE 'ExpoPushToken[%]') THEN
    RAISE EXCEPTION 'Invalid device or push token';
  END IF;
  SELECT * INTO device FROM public.user_devices WHERE user_id = auth.uid()
    AND device_fingerprint = p_device_fingerprint AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current device is not registered'; END IF;
  IF NOT device.push_enabled THEN RETURN false; END IF;
  UPDATE public.user_devices SET expo_push_token = token, push_token_updated_at = now(), last_seen_at = now()
    WHERE id = device.id;
  UPDATE public.users SET push_token = token WHERE id = auth.uid();
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_current_device_push_token(p_device_fingerprint TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE device public.user_devices%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO device FROM public.user_devices WHERE user_id = auth.uid()
    AND device_fingerprint = p_device_fingerprint AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.user_devices SET push_enabled = false, expo_push_token = NULL, push_token_updated_at = now()
    WHERE id = device.id;
  UPDATE public.users SET push_token = NULL WHERE id = auth.uid() AND push_token = device.expo_push_token;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.enable_current_device_push(p_device_fingerprint TEXT, p_expo_push_token TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  UPDATE public.user_devices SET push_enabled = true WHERE user_id = auth.uid()
    AND device_fingerprint = p_device_fingerprint AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current device is not registered'; END IF;
  RETURN public.set_current_device_push_token(p_device_fingerprint, p_expo_push_token);
END;
$$;

REVOKE ALL ON FUNCTION public.set_current_device_push_token(TEXT,TEXT),
  public.clear_current_device_push_token(TEXT), public.enable_current_device_push(TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_current_device_push_token(TEXT,TEXT),
  public.clear_current_device_push_token(TEXT), public.enable_current_device_push(TEXT,TEXT) TO authenticated;

CREATE TABLE public.notification_runtime (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id), enabled BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO public.notification_runtime(id) VALUES (true);
ALTER TABLE public.notification_runtime ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_runtime FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_runtime TO service_role;

CREATE TABLE public.maintenance_notification_settings (
  vessel_id UUID PRIMARY KEY REFERENCES public.vessels(id) ON DELETE CASCADE,
  recipient_ids UUID[] NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE public.maintenance_notification_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.maintenance_notification_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.maintenance_notification_settings TO service_role;

-- Named people, never positions. The same existing device/subscription/vessel
-- authorization used for other HOD/Captain controls is enforced on the server.
CREATE FUNCTION public.get_maintenance_notification_recipients(p_vessel_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result JSONB;
BEGIN
  IF public.current_user_can_manage_vessel(p_vessel_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only Captain MOV and HOD users on this vessel can manage notification recipients' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'recipientIds',COALESCE((SELECT to_jsonb(recipient_ids) FROM public.maintenance_notification_settings WHERE vessel_id = p_vessel_id),'[]'::JSONB),
    'revision',COALESCE((SELECT revision FROM public.maintenance_notification_settings WHERE vessel_id = p_vessel_id),0),
    'crew',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id)
      FROM public.users WHERE vessel_id = p_vessel_id),'[]'::JSONB)
  ) INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION public.set_maintenance_notification_recipients(p_vessel_id UUID, p_recipient_ids UUID[], p_revision INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE selected UUID[]; current_revision INTEGER;
BEGIN
  IF public.current_user_can_manage_vessel(p_vessel_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only Captain MOV and HOD users on this vessel can manage notification recipients' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_ids IS NULL OR array_position(p_recipient_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid recipient selection';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id),ARRAY[]::UUID[]) INTO selected FROM unnest(p_recipient_ids) id;
  -- Match the turnover trigger's lock order (user first, settings second).
  PERFORM id FROM public.users WHERE id = ANY(selected) AND vessel_id = p_vessel_id ORDER BY id FOR SHARE;
  IF (SELECT count(*) FROM public.users WHERE id = ANY(selected) AND vessel_id = p_vessel_id) <> cardinality(selected) THEN
    RAISE EXCEPTION 'Crew list changed. Reload the crew list before saving.';
  END IF;
  INSERT INTO public.maintenance_notification_settings(vessel_id) VALUES(p_vessel_id) ON CONFLICT DO NOTHING;
  SELECT revision INTO current_revision FROM public.maintenance_notification_settings WHERE vessel_id = p_vessel_id FOR UPDATE;
  IF p_revision IS DISTINCT FROM current_revision THEN
    RAISE EXCEPTION 'Recipients changed. Reload the crew list before saving.';
  END IF;
  UPDATE public.maintenance_notification_settings SET recipient_ids = selected, revision = revision + 1 WHERE vessel_id = p_vessel_id;
  RETURN jsonb_build_object('recipientIds',to_jsonb(selected),'revision',current_revision + 1);
END;
$$;
REVOKE ALL ON FUNCTION public.get_maintenance_notification_recipients(UUID),
  public.set_maintenance_notification_recipients(UUID,UUID[],INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_maintenance_notification_recipients(UUID),
  public.set_maintenance_notification_recipients(UUID,UUID[],INTEGER) TO authenticated;

-- Turnover cleanup cannot depend on the phone that removes/leaves the vessel.
CREATE FUNCTION public.prune_maintenance_notification_recipient() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.vessel_id IS DISTINCT FROM OLD.vessel_id THEN
    UPDATE public.maintenance_notification_settings SET recipient_ids = array_remove(recipient_ids,OLD.id), revision = revision + 1
      WHERE OLD.id = ANY(recipient_ids);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_maintenance_notification_recipient() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER prune_maintenance_notification_recipient BEFORE UPDATE OF vessel_id OR DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.prune_maintenance_notification_recipient();

CREATE TABLE public.notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_key TEXT NOT NULL,
  source_table TEXT NOT NULL, source_id UUID NOT NULL, vessel_id UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL, preference TEXT NOT NULL, department TEXT,
  event TEXT NOT NULL CHECK (event IN ('created','updated','reminder')),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','checking','confirmed','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0, available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_id UUID, lease_until TIMESTAMPTZ, ticket_id TEXT, last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_key, token)
);
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_deliveries TO service_role;
CREATE INDEX notification_deliveries_due ON public.notification_deliveries(available_at)
  WHERE status IN ('pending','sending','accepted','checking');

-- Recipients are snapshotted at save time. Primary AND secondary departments
-- count; captain/HOD roles do not bypass the chosen department scope.
CREATE FUNCTION public.enqueue_notification(p_table TEXT, p_record JSONB, p_event TEXT, p_key TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pref TEXT; dept TEXT; targets TEXT[]; safe_payload JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.notification_runtime WHERE enabled) THEN RETURN; END IF;
  CASE p_table
    WHEN 'crew_leave' THEN
      pref := 'crewLeave'; targets := ARRAY[p_record->>'crew_member_id'];
      safe_payload := jsonb_build_object('leave_type',p_record->>'leave_type','start_date',p_record->>'start_date','end_date',p_record->>'end_date');
    WHEN 'vessel_tasks' THEN
      pref := 'tasks'; dept := p_record->>'department';
      safe_payload := jsonb_build_object('title',p_record->>'title','category',p_record->>'category');
    WHEN 'yard_period_jobs' THEN
      pref := 'yardJobs'; dept := p_record->>'department';
      safe_payload := jsonb_build_object('title',p_record->>'job_title');
    WHEN 'maintenance_logs' THEN
      pref := 'maintenance';
      SELECT recipient_ids::TEXT[] INTO targets FROM public.maintenance_notification_settings WHERE vessel_id = (p_record->>'vessel_id')::UUID;
      targets := COALESCE(targets, ARRAY[]::TEXT[]);
      safe_payload := jsonb_build_object('title',p_record->>'equipment');
    WHEN 'watch_keeping_timetables' THEN
      pref := 'watchSchedule';
      SELECT COALESCE(array_agg(DISTINCT value->>'crewId'), ARRAY[]::TEXT[]) INTO targets
        FROM jsonb_array_elements(p_record->'slots');
      safe_payload := jsonb_build_object('title',p_record->>'watch_title');
    WHEN 'trips' THEN
      pref := CASE WHEN p_event = 'reminder' THEN 'dayBefore' ELSE 'trips' END;
      safe_payload := jsonb_build_object('title',p_record->>'title','type',p_record->>'type','start_date',p_record->>'start_date','end_date',p_record->>'end_date');
    WHEN 'pre_departure_checklists' THEN
      pref := 'preDeparture';
      safe_payload := jsonb_build_object('title',p_record->>'title','trip_id',p_record->>'trip_id');
    ELSE RAISE EXCEPTION 'Unsupported notification source';
  END CASE;
  INSERT INTO public.notification_deliveries(event_key,source_table,source_id,vessel_id,recipient_id,token,preference,department,event,payload)
    SELECT DISTINCT p_key,p_table,(p_record->>'id')::UUID,u.vessel_id,u.id,d.expo_push_token,pref,dept,p_event,safe_payload
    FROM public.users u JOIN public.user_devices d ON d.user_id = u.id
    WHERE u.vessel_id = (p_record->>'vessel_id')::UUID
      AND (targets IS NULL OR u.id::TEXT = ANY(targets))
      AND (dept IS NULL OR u.department = dept OR u.department_2 = dept)
      AND d.revoked_at IS NULL AND d.push_enabled AND d.expo_push_token IS NOT NULL
      AND CASE WHEN pref = 'dayBefore' THEN
        COALESCE(u.notification_preferences->>'trips','true') <> 'false' OR COALESCE(u.notification_preferences->>'preDeparture','true') <> 'false'
        ELSE COALESCE(u.notification_preferences->>pref,'true') <> 'false' END
    ON CONFLICT(event_key,token) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_notification(TEXT,JSONB,TEXT,TEXT) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.capture_operational_notification() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_data JSONB := to_jsonb(NEW); old_data JSONB;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    -- Ignore timestamp-only/no-op writes (including idempotent saves).
    IF row_data - 'updated_at' IS NOT DISTINCT FROM old_data - 'updated_at' THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'pre_departure_checklists' THEN
    IF row_data->>'trip_id' IS NULL OR (TG_OP = 'UPDATE' AND row_data->>'trip_id' IS NOT DISTINCT FROM old_data->>'trip_id') THEN RETURN NEW; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.trips WHERE id = (row_data->>'trip_id')::UUID AND vessel_id = NEW.vessel_id) THEN RETURN NEW; END IF;
  END IF;
  PERFORM public.enqueue_notification(TG_TABLE_NAME,row_data,CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END,gen_random_uuid()::TEXT);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_operational_notification() FROM PUBLIC, anon, authenticated;

-- There are intentionally no DELETE notifications and no historical backfill.
DO $$ DECLARE tbl TEXT; BEGIN
  FOREACH tbl IN ARRAY ARRAY['crew_leave','vessel_tasks','yard_period_jobs','maintenance_logs','watch_keeping_timetables','trips','pre_departure_checklists'] LOOP
    EXECUTE format('CREATE TRIGGER capture_notification AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.capture_operational_notification()',tbl);
  END LOOP;
END $$;

CREATE FUNCTION public.enqueue_trip_notification_reminders() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE trip RECORD; tomorrow DATE := (now() AT TIME ZONE 'UTC')::DATE + 1;
BEGIN
  -- Match the existing reminder's UTC date convention, once per trip/day/device.
  FOR trip IN SELECT * FROM public.trips WHERE start_date = tomorrow LOOP
    PERFORM public.enqueue_notification('trips',to_jsonb(trip),'reminder','reminder:'||trip.id||':'||tomorrow);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_trip_notification_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_trip_notification_reminders() TO service_role;

-- Recheck membership, department, selection and opt-out at send time too.
CREATE FUNCTION public.notification_delivery_allowed(q public.notification_deliveries) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE source JSONB;
BEGIN
  IF q.source_table NOT IN ('crew_leave','vessel_tasks','yard_period_jobs','maintenance_logs','watch_keeping_timetables','trips','pre_departure_checklists') THEN RETURN false; END IF;
  EXECUTE format('SELECT to_jsonb(s) FROM public.%I s WHERE id = $1 AND vessel_id = $2',q.source_table)
    INTO source USING q.source_id,q.vessel_id;
  IF source IS NULL THEN RETURN false; END IF;
  IF q.source_table = 'crew_leave' AND source->>'crew_member_id' IS DISTINCT FROM q.recipient_id::TEXT THEN RETURN false; END IF;
  IF q.source_table = 'maintenance_logs' AND NOT EXISTS(SELECT 1 FROM public.maintenance_notification_settings
    WHERE vessel_id = q.vessel_id AND q.recipient_id = ANY(recipient_ids)) THEN RETURN false; END IF;
  IF q.source_table = 'watch_keeping_timetables' AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(source->'slots') WHERE value->>'crewId' = q.recipient_id::TEXT) THEN RETURN false; END IF;
  IF q.source_table IN ('vessel_tasks','yard_period_jobs') AND source->>'department' IS DISTINCT FROM q.department THEN RETURN false; END IF;
  IF q.event = 'reminder' AND source->>'start_date' IS DISTINCT FROM q.payload->>'start_date' THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM public.users u JOIN public.user_devices d ON d.user_id = u.id
    WHERE u.id = q.recipient_id AND u.vessel_id = q.vessel_id AND d.expo_push_token = q.token
    AND d.revoked_at IS NULL AND d.push_enabled
    AND (q.department IS NULL OR u.department = q.department OR u.department_2 = q.department)
    AND CASE WHEN q.preference = 'dayBefore' THEN
      COALESCE(u.notification_preferences->>'trips','true') <> 'false' OR COALESCE(u.notification_preferences->>'preDeparture','true') <> 'false'
      ELSE COALESCE(u.notification_preferences->>q.preference,'true') <> 'false' END);
END;
$$;
REVOKE ALL ON FUNCTION public.notification_delivery_allowed(public.notification_deliveries) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_delivery_allowed(public.notification_deliveries) TO service_role;

CREATE FUNCTION public.claim_notification_deliveries(p_receipts BOOLEAN DEFAULT false)
RETURNS SETOF public.notification_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.notification_runtime WHERE enabled) THEN RETURN; END IF;
  UPDATE public.notification_deliveries SET status = 'failed', last_error = 'Retry window exhausted', updated_at = now()
    WHERE status IN ('pending','sending','accepted','checking')
    AND (created_at < now() - INTERVAL '23 hours' OR (attempts >= 5 AND status IN ('pending','sending')))
    AND (lease_until IS NULL OR lease_until < now());
  IF NOT p_receipts THEN
    UPDATE public.notification_deliveries q SET status = 'skipped',last_error = 'Recipient or source no longer eligible',updated_at = now()
      WHERE status = 'pending' AND available_at <= now() AND NOT public.notification_delivery_allowed(q);
  END IF;
  RETURN QUERY
    WITH due AS (
      SELECT id FROM public.notification_deliveries q WHERE available_at <= now()
        AND (lease_until IS NULL OR lease_until < now())
        AND CASE WHEN p_receipts THEN status IN ('accepted','checking')
          ELSE status IN ('pending','sending') AND public.notification_delivery_allowed(q) END
      ORDER BY available_at LIMIT 25 FOR UPDATE SKIP LOCKED
    ) UPDATE public.notification_deliveries q
      SET status = CASE WHEN p_receipts THEN 'checking' ELSE 'sending' END,
          lease_id = gen_random_uuid(),lease_until = now() + INTERVAL '5 minutes',updated_at = now(),
          attempts = attempts + CASE WHEN p_receipts THEN 0 ELSE 1 END
      FROM due WHERE q.id = due.id RETURNING q.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_notification_deliveries(BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_deliveries(BOOLEAN) TO service_role;

COMMIT;
