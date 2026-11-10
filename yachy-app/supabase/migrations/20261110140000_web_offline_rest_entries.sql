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
      'restEntries',jsonb_build_array('read','create','update'),
      'restReview',CASE WHEN public.current_user_is_captain_of(p_vessel_id) THEN jsonb_build_array('read','create','update') ELSE '[]'::jsonb END,
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



-- Versions of the watches actually shown in the editor accompany confirmations.
-- The writer role has no BYPASSRLS and does not own application tables.
CREATE FUNCTION public.web_offline_watch_versions(p_vessel_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(w.id::text,md5(to_jsonb(w)::text)),'{}'::jsonb)
 FROM public.watch_keeping_timetables w WHERE w.vessel_id=p_vessel_id;
$$;
REVOKE ALL ON FUNCTION public.web_offline_watch_versions(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.web_offline_watch_versions(uuid) TO authenticated;
CREATE FUNCTION public.read_web_offline_rest_context(p_vessel_id uuid,p_device_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 RETURN jsonb_build_object('hasSignature',EXISTS(SELECT 1 FROM public.user_signatures WHERE user_id=auth.uid()));
END; $$;
REVOKE ALL ON FUNCTION public.read_web_offline_rest_context(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_rest_context(uuid,text) TO authenticated;
 
CREATE FUNCTION public.read_web_offline_rest_entries(p_vessel_id uuid,p_device_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',to_jsonb(r)||jsonb_build_object('watch_versions','{}'::jsonb),'revision',md5(to_jsonb(r)::text)) ORDER BY r.id) FROM public.rest_entries r WHERE r.vessel_id=p_vessel_id AND r.user_id=auth.uid()),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.read_web_offline_rest_entries(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_rest_entries(uuid,text) TO authenticated;
 
CREATE FUNCTION public.read_web_offline_rest_review(p_vessel_id uuid,p_device_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 IF NOT public.current_user_is_captain_of(p_vessel_id) THEN RAISE EXCEPTION 'Captain review required' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',to_jsonb(r)||jsonb_build_object('watch_versions','{}'::jsonb),'revision',md5(to_jsonb(r)::text)) ORDER BY r.id) FROM public.rest_entries r WHERE r.vessel_id=p_vessel_id AND r.user_id<>auth.uid()),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.read_web_offline_rest_review(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_rest_review(uuid,text) TO authenticated;

-- React Native comment limits count UTF-16 units, including surrogate pairs.
CREATE FUNCTION public.web_offline_rest_comment_length(value text) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(sum(CASE WHEN ascii(c)>65535 THEN 2 ELSE 1 END),0)::integer FROM regexp_split_to_table(coalesce(value,''),'') c;
$$;
REVOKE ALL ON FUNCTION public.web_offline_rest_comment_length(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.web_offline_rest_comment_length(text) TO authenticated;
CREATE FUNCTION public.sync_web_offline_rest_entries(p_vessel_id uuid,p_device_id text,p_operation jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op_id uuid;row_id uuid;v jsonb;old public.rest_entries%ROWTYPE;
 receipt offline_private.record_receipts%ROWTYPE; captain boolean;feature text; target_user uuid; target_date date; period jsonb;
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 feature:=p_operation->>'feature';
 IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR octet_length(p_operation::text)>260000 OR feature IS NULL OR feature NOT IN('restEntries','restReview')
 OR p_operation->>'kind' IS NULL OR p_operation->>'kind' NOT IN('create','update')
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','recordId','feature','kind','value','baseRevision')) THEN RAISE EXCEPTION 'Invalid offline operation' USING ERRCODE='22023'; END IF;
 op_id:=(p_operation->>'id')::uuid;row_id:=(p_operation->>'recordId')::uuid;v:=p_operation->'value';
 IF op_id IS NULL OR row_id IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object'
 OR v->>'id' IS DISTINCT FROM row_id::text OR v->>'vessel_id' IS DISTINCT FROM p_vessel_id::text
 OR NOT(v ?& ARRAY['id','vessel_id','user_id','date','rest_periods','work_start','work_end','lunch_start','lunch_end','comment','status','confirmed_by','confirmed_at','created_at','updated_at','watch_versions'])
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','vessel_id','user_id','date','rest_periods','work_start','work_end','lunch_start','lunch_end','comment','status','confirmed_by','confirmed_at','created_at','updated_at','watch_versions'))
 OR jsonb_typeof(v->'date') IS DISTINCT FROM 'string' OR v->>'date' !~ '^\d{4}-\d{2}-\d{2}$'
 OR jsonb_typeof(v->'user_id') IS DISTINCT FROM 'string'
 OR jsonb_typeof(v->'rest_periods') IS DISTINCT FROM 'array'
 OR jsonb_typeof(v->'status') IS DISTINCT FROM 'string' OR v->>'status' NOT IN('draft','pending_confirmation','confirmed','needs_reconfirmation')
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['work_start','work_end','lunch_start','lunch_end']) k WHERE jsonb_typeof(v->k) NOT IN('null','string') OR (jsonb_typeof(v->k)='string' AND v->>k !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['comment','confirmed_by','confirmed_at']) k WHERE jsonb_typeof(v->k) NOT IN('null','string'))
 OR jsonb_typeof(v->'watch_versions') IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'Invalid rest entry' USING ERRCODE='22023'; END IF;
 target_user:=(v->>'user_id')::uuid;target_date:=(v->>'date')::date;
 IF target_user IS NULL THEN RAISE EXCEPTION 'Invalid rest owner' USING ERRCODE='22023'; END IF;
 FOR period IN SELECT value FROM jsonb_array_elements(v->'rest_periods') LOOP
  IF jsonb_typeof(period) IS DISTINCT FROM 'object' OR NOT(period ?& ARRAY['start','end'])
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(period) k WHERE k NOT IN('start','end'))
  OR jsonb_typeof(period->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(period->'end') IS DISTINCT FROM 'string'
  OR period->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR period->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  THEN RAISE EXCEPTION 'Invalid rest interval' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_each(v->'watch_versions') e WHERE e.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR jsonb_typeof(e.value)<>'string' OR e.value #>> '{}' !~ '^[0-9a-f]{32}$') THEN RAISE EXCEPTION 'Invalid watch versions' USING ERRCODE='22023'; END IF;
 captain:=public.current_user_is_captain_of(p_vessel_id);
 IF (feature='restEntries' AND target_user<>auth.uid()) OR (feature='restReview' AND (target_user=auth.uid() OR NOT captain))
 OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=target_user AND vessel_id=p_vessel_id)
 THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 -- Consistent lock order with the existing watch trigger: watches before rest rows.
 -- This prevents a concurrent publication from racing a new confirmation.
 LOCK TABLE public.watch_keeping_timetables IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||op_id::text,0));
 SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=op_id;
 IF FOUND THEN
  IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>feature THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
  SELECT * INTO old FROM public.rest_entries WHERE id=row_id AND vessel_id=p_vessel_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.user_signatures WHERE user_id=auth.uid()) THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  IF v->>'status'='confirmed' THEN
   IF NOT captain OR v->>'confirmed_by' IS DISTINCT FROM auth.uid()::text THEN RETURN jsonb_build_object('status','forbidden'); END IF;
   IF v->'watch_versions' IS DISTINCT FROM public.web_offline_watch_versions(p_vessel_id) THEN RETURN jsonb_build_object('status','conflict'); END IF;
  ELSIF v->>'confirmed_by' IS NOT NULL OR v->>'confirmed_at' IS NOT NULL THEN RAISE EXCEPTION 'Invalid confirmation metadata' USING ERRCODE='22023'; END IF;
  IF p_operation->>'kind'='create' THEN
   IF p_operation->>'baseRevision' IS NOT NULL THEN RAISE EXCEPTION 'Invalid create revision' USING ERRCODE='22023'; END IF;
   IF public.web_offline_rest_comment_length(v->>'comment')>20 THEN RAISE EXCEPTION 'Comment too long' USING ERRCODE='22023'; END IF;
   INSERT INTO public.rest_entries(id,vessel_id,user_id,date,rest_periods,work_start,work_end,lunch_start,lunch_end,comment,status,confirmed_by,confirmed_at)
   VALUES(row_id,p_vessel_id,target_user,target_date,v->'rest_periods',v->>'work_start',v->>'work_end',v->>'lunch_start',v->>'lunch_end',v->>'comment',v->>'status',CASE WHEN v->>'status'='confirmed' THEN auth.uid() ELSE NULL END,CASE WHEN v->>'status'='confirmed' THEN now() ELSE NULL END)
   ON CONFLICT DO NOTHING RETURNING * INTO old;
   IF NOT FOUND THEN RETURN jsonb_build_object('status','conflict'); END IF;
  ELSE
   SELECT * INTO old FROM public.rest_entries WHERE id=row_id AND vessel_id=p_vessel_id FOR UPDATE;
   IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
   IF md5(to_jsonb(old)::text) IS DISTINCT FROM p_operation->>'baseRevision' THEN RETURN jsonb_build_object('status','conflict'); END IF;
   IF old.user_id<>target_user OR old.date<>target_date THEN RAISE EXCEPTION 'Immutable rest identity' USING ERRCODE='42501'; END IF;
   IF NOT captain AND old.status IN('confirmed','pending_confirmation') THEN RETURN jsonb_build_object('status','forbidden'); END IF;
   IF v->>'comment' IS DISTINCT FROM old.comment AND public.web_offline_rest_comment_length(v->>'comment')>20 THEN RAISE EXCEPTION 'Comment too long' USING ERRCODE='22023'; END IF;
   UPDATE public.rest_entries SET rest_periods=v->'rest_periods',work_start=v->>'work_start',work_end=v->>'work_end',lunch_start=v->>'lunch_start',lunch_end=v->>'lunch_end',comment=v->>'comment',status=v->>'status',confirmed_by=CASE WHEN v->>'status'='confirmed' THEN auth.uid() ELSE NULL END,confirmed_at=CASE WHEN v->>'status'='confirmed' THEN now() ELSE NULL END,updated_at=now()
   WHERE id=row_id AND vessel_id=p_vessel_id RETURNING * INTO old;
   IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  END IF;
  INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash) VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,feature,row_id,md5(p_operation::text));
 END IF;
 RETURN jsonb_build_object('status','applied','operationId',op_id,'recordId',row_id,'value',to_jsonb(old)||jsonb_build_object('watch_versions',v->'watch_versions'),'revision',md5(to_jsonb(old)::text));
END; $$;
GRANT CREATE ON SCHEMA public TO nautical_offline_writer;
ALTER FUNCTION public.sync_web_offline_rest_entries(uuid,text,jsonb) OWNER TO nautical_offline_writer;
REVOKE CREATE ON SCHEMA public FROM nautical_offline_writer;
REVOKE ALL ON FUNCTION public.sync_web_offline_rest_entries(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_web_offline_rest_entries(uuid,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
