-- Keep watch changes and rest reconfirmation in the SAME transaction. The
-- existing timetable RLS still authorizes the initiating INSERT/UPDATE/DELETE.
CREATE OR REPLACE FUNCTION public.watch_affected_rest_days(p_date DATE, p_slots JSONB)
RETURNS TABLE(crew_id UUID, rest_date DATE)
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  slot JSONB; inferred_day DATE := p_date; previous_minutes INTEGER;
  start_minutes INTEGER; end_minutes INTEGER; start_day DATE; end_day DATE;
  starts_at TIMESTAMP; ends_at TIMESTAMP;
BEGIN
  IF p_date IS NULL THEN RETURN; END IF;
  FOR slot IN SELECT value FROM jsonb_array_elements(p_slots) LOOP
    start_minutes := split_part(slot->>'startTimeStr', ':', 1)::INTEGER * 60
      + split_part(slot->>'startTimeStr', ':', 2)::INTEGER;
    end_minutes := split_part(slot->>'endTimeStr', ':', 1)::INTEGER * 60
      + split_part(slot->>'endTimeStr', ':', 2)::INTEGER;
    IF NULLIF(slot->>'startDate', '') IS NOT NULL AND NULLIF(slot->>'endDate', '') IS NOT NULL THEN
      start_day := (slot->>'startDate')::DATE;
      end_day := (slot->>'endDate')::DATE;
      inferred_day := start_day;
    ELSE
      -- Preserve legacy undated-slot midnight inference from the app.
      IF previous_minutes IS NOT NULL AND start_minutes < previous_minutes THEN
        inferred_day := inferred_day + 1;
      END IF;
      start_day := inferred_day;
      end_day := inferred_day + CASE WHEN end_minutes <= start_minutes THEN 1 ELSE 0 END;
    END IF;
    previous_minutes := start_minutes;
    starts_at := start_day::TIMESTAMP + make_interval(mins => start_minutes);
    ends_at := end_day::TIMESTAMP + make_interval(mins => end_minutes);
    IF ends_at <= starts_at THEN ends_at := ends_at + INTERVAL '1 day'; END IF;
    RETURN QUERY
      SELECT (slot->>'crewId')::UUID, day::DATE
      FROM generate_series(start_day::TIMESTAMP, end_day::TIMESTAMP, INTERVAL '1 day') AS day
      WHERE greatest(starts_at, day) < least(ends_at, day + INTERVAL '1 day');
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.watch_affected_rest_days(DATE, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reconfirm_rest_after_watch_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- A repeated identical update must not invalidate a subsequent confirmation.
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE public.rest_entries AS rest
      SET status = 'needs_reconfirmation', confirmed_by = NULL,
          confirmed_at = NULL, updated_at = now()
      WHERE rest.vessel_id = OLD.vessel_id AND rest.status = 'confirmed'
        AND EXISTS (SELECT 1 FROM public.watch_affected_rest_days(OLD.for_date, OLD.slots) AS affected
          WHERE affected.crew_id = rest.user_id AND affected.rest_date = rest.date);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE public.rest_entries AS rest
      SET status = 'needs_reconfirmation', confirmed_by = NULL,
          confirmed_at = NULL, updated_at = now()
      WHERE rest.vessel_id = NEW.vessel_id AND rest.status = 'confirmed'
        AND EXISTS (SELECT 1 FROM public.watch_affected_rest_days(NEW.for_date, NEW.slots) AS affected
          WHERE affected.crew_id = rest.user_id AND affected.rest_date = rest.date);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.reconfirm_rest_after_watch_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reconfirm_rest_after_watch_change
AFTER INSERT OR UPDATE OR DELETE ON public.watch_keeping_timetables
FOR EACH ROW EXECUTE FUNCTION public.reconfirm_rest_after_watch_change();

-- Invoker security: use existing vessel/device/subscription/role policies.
-- One client-generated UUID belongs to one publish attempt, even on retries.
CREATE OR REPLACE FUNCTION public.publish_watch_schedule(p_request_id UUID, p_data JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  saved public.watch_keeping_timetables%ROWTYPE;
  vessel UUID := (p_data->>'vessel_id')::UUID;
  title TEXT := trim(p_data->>'watch_title');
BEGIN
  IF auth.uid() IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Authentication and request ID required'; END IF;
  IF title IS NULL OR title = '' OR jsonb_typeof(p_data->'slots') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'A title and watch slots are required';
  END IF;
  INSERT INTO public.watch_keeping_timetables
    (id, vessel_id, watch_title, start_time, start_location, destination, notes, for_date, slots, created_by)
  VALUES (p_request_id, vessel, title, p_data->>'start_time',
    NULLIF(trim(p_data->>'start_location'), ''), NULLIF(trim(p_data->>'destination'), ''),
    NULLIF(trim(p_data->>'notes'), ''), (p_data->>'for_date')::DATE, p_data->'slots', auth.uid())
  ON CONFLICT (id) DO NOTHING
  RETURNING * INTO saved;
  IF NOT FOUND THEN
    SELECT * INTO saved FROM public.watch_keeping_timetables WHERE id = p_request_id;
    IF NOT FOUND OR saved.created_by IS DISTINCT FROM auth.uid() OR saved.vessel_id IS DISTINCT FROM vessel THEN
      RAISE EXCEPTION 'This publish request is not available';
    END IF;
    IF saved.watch_title IS DISTINCT FROM title OR saved.start_time IS DISTINCT FROM p_data->>'start_time'
      OR saved.start_location IS DISTINCT FROM NULLIF(trim(p_data->>'start_location'), '')
      OR saved.destination IS DISTINCT FROM NULLIF(trim(p_data->>'destination'), '')
      OR saved.notes IS DISTINCT FROM NULLIF(trim(p_data->>'notes'), '')
      OR saved.for_date IS DISTINCT FROM (p_data->>'for_date')::DATE
      OR saved.slots IS DISTINCT FROM p_data->'slots' THEN
      RAISE EXCEPTION 'The earlier publish was saved. Open it in Watch Schedules to edit it.';
    END IF;
  END IF;
  RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_watch_schedule(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_watch_schedule(UUID, JSONB) TO authenticated;
