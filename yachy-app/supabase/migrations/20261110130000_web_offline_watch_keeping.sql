BEGIN;
CREATE OR REPLACE FUNCTION public.get_web_offline_context(p_vessel_id uuid, p_device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  sid uuid := nullif(auth.jwt()->>'session_id','')::uuid;
  access_end timestamptz;
  sub public.vessel_subscriptions%ROWTYPE;
BEGIN
  IF actor IS NULL OR sid IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions WHERE id = sid AND user_id = actor AND (not_after IS NULL OR not_after > now())
  ) OR NOT public.current_user_can_access_vessel(p_vessel_id) OR NOT EXISTS (
    SELECT 1 FROM public.user_devices WHERE user_id = actor AND session_id = sid
      AND device_fingerprint = p_device_id AND revoked_at IS NULL AND platform = 'web'
  ) THEN RAISE EXCEPTION 'Current online access required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO sub FROM public.vessel_subscriptions WHERE vessel_id = p_vessel_id
    ORDER BY current_period_end DESC LIMIT 1;
  IF NOT FOUND OR sub.status = 'revoked' THEN
    RAISE EXCEPTION 'Verified subscription required for offline access' USING ERRCODE = '42501';
  END IF;
  access_end := CASE WHEN sub.status = 'past_due' THEN coalesce(sub.grace_period_end,
    sub.current_period_end + interval '16 days') ELSE sub.current_period_end END;
  IF access_end IS NULL OR access_end <= now() THEN
    RAISE EXCEPTION 'Reconnect for subscription verification' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('userId',actor,'vesselId',p_vessel_id,'deviceId',p_device_id,
    'sessionId',sid,'iat',floor(extract(epoch FROM now())),
    'exp',floor(extract(epoch FROM least(now()+interval '7 days',access_end))),
    'accessUntil',floor(extract(epoch FROM access_end)),
    'permissions',jsonb_build_object('notes',jsonb_build_array('read','create','update'),
      'shoppingLists',jsonb_build_array('read','create','update'),
      'tasks',jsonb_build_array('read','create','update'),
      'trips',jsonb_build_array('read','create','update'),
      'maintenanceLogs',jsonb_build_array('read','create','update'),
      'pumpOutLogs',jsonb_build_array('read','create','update'),
      'generalWasteLogs',jsonb_build_array('read','create','update'),
      'uniforms',jsonb_build_array('read','create','update'),
      'inventory',jsonb_build_array('read','create','update'),
      'watchKeepingRules',CASE WHEN public.current_user_can_manage_vessel(p_vessel_id) THEN jsonb_build_array('read','create','update') ELSE jsonb_build_array('read') END,
      'watchKeeping',CASE WHEN public.current_user_can_manage_vessel(p_vessel_id) THEN jsonb_build_array('read','create','update') WHEN EXISTS(
        SELECT 1 FROM public.users u JOIN public.vessels v ON v.id=u.vessel_id WHERE u.id=actor AND u.role='CREW' AND v.id=p_vessel_id AND v.is_solo=TRUE
      ) THEN jsonb_build_array('read','create') ELSE jsonb_build_array('read') END,
      'crewLeave',CASE WHEN public.current_user_can_manage_vessel(p_vessel_id) THEN jsonb_build_array('read','create','update') ELSE jsonb_build_array('read') END,
      'preDepartureChecklists',CASE WHEN public.current_user_can_manage_vessel(p_vessel_id) THEN jsonb_build_array('read','create','update') ELSE jsonb_build_array('read') END,
      'yardJobs',jsonb_build_array('read','create','update'),
      'shipyardRecords',CASE WHEN public.current_user_is_captain_of(p_vessel_id) THEN jsonb_build_array('read','update') ELSE jsonb_build_array('read') END,
      'contractors',jsonb_build_array('read','create','update'),
      'rules',CASE WHEN public.current_user_can_manage_vessel(p_vessel_id) THEN jsonb_build_array('read','create','update') ELSE jsonb_build_array('read') END,
      'musterStations',CASE WHEN public.current_user_can_manage_vessel(p_vessel_id) THEN jsonb_build_array('read','create','update') ELSE jsonb_build_array('read') END,
      'safetyEquipment',CASE WHEN public.current_user_can_manage_vessel(p_vessel_id) OR EXISTS(
        SELECT 1 FROM public.users u WHERE u.id=actor AND u.role='CREW' AND u.vessel_id=p_vessel_id
      ) THEN jsonb_build_array('read','create','update') ELSE jsonb_build_array('read') END));
END;
$$;
REVOKE ALL ON FUNCTION public.get_web_offline_context(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_web_offline_context(uuid,text) TO authenticated;


-- Called before any writes. Does not trust nested client objects or malformed intervals.
CREATE FUNCTION public.web_offline_valid_watch_slots(p_slots jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE s jsonb; duration numeric;
BEGIN
 IF jsonb_typeof(p_slots) IS DISTINCT FROM 'array' OR jsonb_array_length(p_slots)=0 THEN RETURN false; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_slots) LOOP
  IF jsonb_typeof(s) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(s) k WHERE k NOT IN('crewId','crewName','crewPosition','startTimeStr','endTimeStr','durationHours','startDate','endDate'))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['crewId','crewName','startTimeStr','endTimeStr']) k WHERE jsonb_typeof(s->k) IS DISTINCT FROM 'string')
    OR (s ? 'crewPosition' AND jsonb_typeof(s->'crewPosition') IS DISTINCT FROM 'string')
    OR s->>'crewId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR s->>'startTimeStr' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR s->>'endTimeStr' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR jsonb_typeof(s->'durationHours') IS DISTINCT FROM 'number' OR (s->>'durationHours')::numeric<=0
  THEN RETURN false; END IF;
  IF s ? 'startDate' OR s ? 'endDate' THEN
   IF jsonb_typeof(s->'startDate') IS DISTINCT FROM 'string' OR jsonb_typeof(s->'endDate') IS DISTINCT FROM 'string'
     OR s->>'startDate' !~ '^\d{4}-\d{2}-\d{2}$' OR s->>'endDate' !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN false; END IF;
   duration:=extract(epoch FROM ((s->>'endDate')::date+(s->>'endTimeStr')::time)-((s->>'startDate')::date+(s->>'startTimeStr')::time))/3600;
   IF duration<=0 OR abs(duration-(s->>'durationHours')::numeric)>1.0/60+0.000000001 THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN RETURN false;
END; $$;
REVOKE ALL ON FUNCTION public.web_offline_valid_watch_slots(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.web_offline_valid_watch_slots(jsonb) TO authenticated;

CREATE FUNCTION public.read_web_offline_watch_keeping(p_vessel_id uuid,p_device_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',to_jsonb(s),'revision',md5(to_jsonb(s)::text)) ORDER BY s.id) FROM public.watch_keeping_timetables s WHERE vessel_id=p_vessel_id),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.read_web_offline_watch_keeping(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_watch_keeping(uuid,text) TO authenticated;
CREATE FUNCTION public.sync_web_offline_watch_keeping(p_vessel_id uuid,p_device_id text,p_operation jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op_id uuid;row_id uuid;v jsonb;old public.watch_keeping_timetables%ROWTYPE;receipt offline_private.record_receipts%ROWTYPE;
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR octet_length(p_operation::text)>260000 OR p_operation->>'feature' IS DISTINCT FROM 'watchKeeping'
 OR p_operation->>'kind' IS NULL OR p_operation->>'kind' NOT IN('create','update') OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','recordId','feature','kind','value','baseRevision')) THEN RAISE EXCEPTION 'Invalid offline operation' USING ERRCODE='22023'; END IF;
 op_id:=(p_operation->>'id')::uuid;row_id:=(p_operation->>'recordId')::uuid;v:=p_operation->'value';
 IF op_id IS NULL OR row_id IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR v->>'id' IS DISTINCT FROM row_id::text OR v->>'vessel_id' IS DISTINCT FROM p_vessel_id::text
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','vessel_id','watch_title','start_time','start_location','destination','notes','for_date','slots','created_by','created_at')) OR NOT(v ?& ARRAY['id','vessel_id','watch_title','start_time','start_location','destination','notes','for_date','slots','created_by','created_at']) OR jsonb_typeof(v->'watch_title') IS DISTINCT FROM 'string' OR length(btrim(v->>'watch_title'))=0
    OR jsonb_typeof(v->'start_time') IS DISTINCT FROM 'string' OR v->>'start_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['start_location','destination','notes','created_by']) k WHERE jsonb_typeof(v->k) NOT IN('null','string'))
    OR jsonb_typeof(v->'for_date') NOT IN('null','string') OR (jsonb_typeof(v->'for_date')='string' AND v->>'for_date' !~ '^\d{4}-\d{2}-\d{2}$')
    OR NOT public.web_offline_valid_watch_slots(v->'slots')
 THEN RAISE EXCEPTION 'Invalid watch record' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||op_id::text,0));
 SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=op_id;
 IF FOUND THEN
  IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>'watchKeeping' THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
  SELECT * INTO old FROM public.watch_keeping_timetables WHERE id=row_id AND vessel_id=p_vessel_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 ELSIF p_operation->>'kind'='create' THEN
  IF p_operation->>'baseRevision' IS NOT NULL OR v->>'created_by' IS DISTINCT FROM auth.uid()::text THEN RAISE EXCEPTION 'Invalid create identity' USING ERRCODE='42501'; END IF;
  IF v->>'for_date' IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(v->'slots') s WHERE NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=(s->>'crewId')::uuid AND u.vessel_id=p_vessel_id)) THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  INSERT INTO public.watch_keeping_timetables(id,vessel_id,watch_title,start_time,start_location,destination,notes,for_date,slots,created_by) VALUES(row_id,p_vessel_id,v->>'watch_title',v->>'start_time',v->>'start_location',v->>'destination',v->>'notes',(v->>'for_date')::date,v->'slots',auth.uid()) ON CONFLICT DO NOTHING RETURNING * INTO old;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','conflict'); END IF;
  INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash) VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'watchKeeping',row_id,md5(p_operation::text));
 ELSE
  SELECT * INTO old FROM public.watch_keeping_timetables WHERE id=row_id AND vessel_id=p_vessel_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  IF md5(to_jsonb(old)::text) IS DISTINCT FROM p_operation->>'baseRevision' THEN RETURN jsonb_build_object('status','conflict'); END IF;
  IF v->>'created_by' IS DISTINCT FROM old.created_by::text THEN RAISE EXCEPTION 'Immutable schedule identity' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'slots') s WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old.slots) prior WHERE prior=s) AND NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=(s->>'crewId')::uuid AND u.vessel_id=p_vessel_id)) THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  UPDATE public.watch_keeping_timetables SET watch_title=v->>'watch_title',start_time=v->>'start_time',start_location=v->>'start_location',destination=v->>'destination',notes=v->>'notes',for_date=(v->>'for_date')::date,slots=v->'slots' WHERE id=row_id AND vessel_id=p_vessel_id RETURNING * INTO old;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash) VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'watchKeeping',row_id,md5(p_operation::text));
 END IF;
 RETURN jsonb_build_object('status','applied','operationId',op_id,'recordId',row_id,'value',to_jsonb(old),'revision',md5(to_jsonb(old)::text));
END; $$;
GRANT CREATE ON SCHEMA public TO nautical_offline_writer;
ALTER FUNCTION public.sync_web_offline_watch_keeping(uuid,text,jsonb) OWNER TO nautical_offline_writer;
REVOKE CREATE ON SCHEMA public FROM nautical_offline_writer;
REVOKE ALL ON FUNCTION public.sync_web_offline_watch_keeping(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_web_offline_watch_keeping(uuid,text,jsonb) TO authenticated;

CREATE FUNCTION public.read_web_offline_watch_rules(p_vessel_id uuid,p_device_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',to_jsonb(s),'revision',md5(to_jsonb(s)::text)) ORDER BY s.id) FROM public.watch_keeping_rules s WHERE vessel_id=p_vessel_id),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.read_web_offline_watch_rules(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_watch_rules(uuid,text) TO authenticated;
CREATE FUNCTION public.sync_web_offline_watch_rules(p_vessel_id uuid,p_device_id text,p_operation jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op_id uuid;row_id uuid;v jsonb;old public.watch_keeping_rules%ROWTYPE;receipt offline_private.record_receipts%ROWTYPE;
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR octet_length(p_operation::text)>260000 OR p_operation->>'feature' IS DISTINCT FROM 'watchKeepingRules'
 OR p_operation->>'kind' IS NULL OR p_operation->>'kind' NOT IN('create','update') OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','recordId','feature','kind','value','baseRevision')) THEN RAISE EXCEPTION 'Invalid offline operation' USING ERRCODE='22023'; END IF;
 op_id:=(p_operation->>'id')::uuid;row_id:=(p_operation->>'recordId')::uuid;v:=p_operation->'value';
 IF op_id IS NULL OR row_id IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR v->>'id' IS DISTINCT FROM row_id::text OR v->>'vessel_id' IS DISTINCT FROM p_vessel_id::text
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','vessel_id','content','updated_at','updated_by')) OR NOT(v ?& ARRAY['id','vessel_id','content','updated_at','updated_by']) OR jsonb_typeof(v->'content') IS DISTINCT FROM 'string'
 THEN RAISE EXCEPTION 'Invalid watch record' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||op_id::text,0));
 SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=op_id;
 IF FOUND THEN
  IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>'watchKeepingRules' THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
  SELECT * INTO old FROM public.watch_keeping_rules WHERE id=row_id AND vessel_id=p_vessel_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 ELSIF p_operation->>'kind'='create' THEN
  IF p_operation->>'baseRevision' IS NOT NULL OR v->>'updated_by' IS DISTINCT FROM auth.uid()::text THEN RAISE EXCEPTION 'Invalid create identity' USING ERRCODE='42501'; END IF;
  
  INSERT INTO public.watch_keeping_rules(id,vessel_id,content,updated_by) VALUES(row_id,p_vessel_id,v->>'content',auth.uid()) ON CONFLICT DO NOTHING RETURNING * INTO old;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','conflict'); END IF;
  INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash) VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'watchKeepingRules',row_id,md5(p_operation::text));
 ELSE
  SELECT * INTO old FROM public.watch_keeping_rules WHERE id=row_id AND vessel_id=p_vessel_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  IF md5(to_jsonb(old)::text) IS DISTINCT FROM p_operation->>'baseRevision' THEN RETURN jsonb_build_object('status','conflict'); END IF;
  
  
  UPDATE public.watch_keeping_rules SET content=v->>'content',updated_by=auth.uid(),updated_at=now() WHERE id=row_id AND vessel_id=p_vessel_id RETURNING * INTO old;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash) VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'watchKeepingRules',row_id,md5(p_operation::text));
 END IF;
 RETURN jsonb_build_object('status','applied','operationId',op_id,'recordId',row_id,'value',to_jsonb(old),'revision',md5(to_jsonb(old)::text));
END; $$;
GRANT CREATE ON SCHEMA public TO nautical_offline_writer;
ALTER FUNCTION public.sync_web_offline_watch_rules(uuid,text,jsonb) OWNER TO nautical_offline_writer;
REVOKE CREATE ON SCHEMA public FROM nautical_offline_writer;
REVOKE ALL ON FUNCTION public.sync_web_offline_watch_rules(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_web_offline_watch_rules(uuid,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
