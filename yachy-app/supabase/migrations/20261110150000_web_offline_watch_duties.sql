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
      'watchDutyChecks',jsonb_build_array('read','create','update'),
      'watchDuties',CASE WHEN public.current_user_can_manage_vessel(p_vessel_id) THEN jsonb_build_array('read','create','update') ELSE jsonb_build_array('read') END,
      'watchDutyRules',CASE WHEN public.current_user_can_manage_vessel(p_vessel_id) THEN jsonb_build_array('read','create','update') ELSE jsonb_build_array('read') END,
      'watchAssignments',CASE WHEN public.current_user_can_manage_vessel(p_vessel_id) THEN jsonb_build_array('read','create','update') ELSE jsonb_build_array('read') END,
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



-- Aggregate definitions exclude personal completion rows. Checkmarks have a separate per-user revision.
CREATE FUNCTION public.web_offline_duty_group(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT to_jsonb(g)||jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.sort_order,i.id) FROM public.watch_duty_items i WHERE i.group_id=g.id),'[]'::jsonb)) FROM public.watch_duty_groups g WHERE g.id=p_id;
$$;
REVOKE ALL ON FUNCTION public.web_offline_duty_group(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.web_offline_duty_group(uuid) TO authenticated;
CREATE FUNCTION public.read_web_offline_watch_duties(p_vessel_id uuid,p_device_id text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',v,'revision',md5(v::text))) FROM (SELECT public.web_offline_duty_group(r.id) v FROM public.watch_duty_groups r WHERE r.vessel_id=p_vessel_id) q),'[]'::jsonb);
 END; $$;
 REVOKE ALL ON FUNCTION public.read_web_offline_watch_duties(uuid,text) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.read_web_offline_watch_duties(uuid,text) TO authenticated;
CREATE FUNCTION public.sync_web_offline_watch_duties(p_vessel_id uuid,p_device_id text,p_operation jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE op_id uuid;row_id uuid;v jsonb;old jsonb;item jsonb;receipt offline_private.record_receipts%ROWTYPE;
 BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR octet_length(p_operation::text)>260000 OR p_operation->>'feature' IS DISTINCT FROM 'watchDuties'
 OR p_operation->>'kind' IS NULL OR p_operation->>'kind' NOT IN('create','update') OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','recordId','feature','kind','value','baseRevision'))
 THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
 op_id:=(p_operation->>'id')::uuid;row_id:=(p_operation->>'recordId')::uuid;v:=p_operation->'value';
 IF op_id IS NULL OR row_id IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR v->>'id' IS DISTINCT FROM row_id::text OR v->>'vessel_id' IS DISTINCT FROM p_vessel_id::text
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','vessel_id','title','department','created_at','items')) OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','vessel_id','title','department','created_at']) k WHERE jsonb_typeof(v->k) IS DISTINCT FROM 'string')
 THEN RAISE EXCEPTION 'Invalid record' USING ERRCODE='22023'; END IF;

 IF length(trim(v->>'title'))=0 OR v->>'department' NOT IN('BRIDGE','ENGINEERING','EXTERIOR','INTERIOR','GALLEY') OR jsonb_typeof(v->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid duty group' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'items') i WHERE jsonb_typeof(i)<>'object') THEN RAISE EXCEPTION 'Invalid items' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'items') i WHERE
 EXISTS(SELECT 1 FROM jsonb_object_keys(i) k WHERE k NOT IN('id','group_id','label','sort_order','created_at')) OR
 EXISTS(SELECT 1 FROM unnest(ARRAY['id','group_id','label','created_at']) k WHERE jsonb_typeof(i->k) IS DISTINCT FROM 'string') OR
 i->>'group_id' IS DISTINCT FROM row_id::text OR jsonb_typeof(i->'sort_order') IS DISTINCT FROM 'number' OR (i->>'sort_order')::numeric<>trunc((i->>'sort_order')::numeric))
 OR (SELECT count(*)<>count(DISTINCT i->>'id') FROM jsonb_array_elements(v->'items') i)
 THEN RAISE EXCEPTION 'Invalid duty items' USING ERRCODE='22023'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||op_id::text,0));
 LOCK TABLE public.watch_duty_groups,public.watch_duty_items,public.watch_duty_completions IN SHARE ROW EXCLUSIVE MODE;
 SELECT public.web_offline_duty_group(r.id) INTO old FROM public.watch_duty_groups r WHERE r.id=row_id AND r.vessel_id=p_vessel_id;
 SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=op_id;
 IF FOUND THEN
 IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>'watchDuties' THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
 IF old IS NULL THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 ELSE
 IF NOT public.current_user_can_manage_vessel(p_vessel_id) THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 IF p_operation->>'kind'='create' THEN
 IF old IS NOT NULL OR p_operation->>'baseRevision' IS NOT NULL THEN RETURN jsonb_build_object('status','conflict'); END IF;
 ELSE
 IF old IS NULL THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 IF md5(old::text) IS DISTINCT FROM p_operation->>'baseRevision' THEN RETURN jsonb_build_object('status','conflict'); END IF;
 END IF;
 BEGIN

 IF old IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(old->'items') i WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'items') n WHERE n->>'id'=i->>'id')) THEN RAISE EXCEPTION 'Deletion requires online access' USING ERRCODE='42501'; END IF;
 IF old IS NULL THEN INSERT INTO public.watch_duty_groups(id,vessel_id,title,department) VALUES(row_id,p_vessel_id,v->>'title',v->>'department');
 ELSE UPDATE public.watch_duty_groups SET title=v->>'title',department=v->>'department' WHERE id=row_id;IF NOT FOUND THEN RAISE insufficient_privilege; END IF; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(v->'items') LOOP
 IF old IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(old->'items') i WHERE i->>'id'=item->>'id') THEN
 UPDATE public.watch_duty_items SET label=item->>'label',sort_order=(item->>'sort_order')::integer WHERE id=(item->>'id')::uuid AND group_id=row_id;IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
 ELSE INSERT INTO public.watch_duty_items(id,group_id,label,sort_order) VALUES((item->>'id')::uuid,row_id,item->>'label',(item->>'sort_order')::integer); END IF;
 END LOOP;

 INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash) VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'watchDuties',row_id,md5(p_operation::text));
 EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('status','forbidden'); WHEN unique_violation OR serialization_failure OR foreign_key_violation THEN RETURN jsonb_build_object('status','conflict'); END;
 SELECT public.web_offline_duty_group(r.id) INTO old FROM public.watch_duty_groups r WHERE r.id=row_id AND r.vessel_id=p_vessel_id;
 END IF;
 RETURN jsonb_build_object('status','applied','operationId',op_id,'recordId',row_id,'value',old,'revision',md5(old::text));
 END; $$;
 GRANT CREATE ON SCHEMA public TO nautical_offline_writer;
 ALTER FUNCTION public.sync_web_offline_watch_duties(uuid,text,jsonb) OWNER TO nautical_offline_writer;
 REVOKE CREATE ON SCHEMA public FROM nautical_offline_writer;
 REVOKE ALL ON FUNCTION public.sync_web_offline_watch_duties(uuid,text,jsonb) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.sync_web_offline_watch_duties(uuid,text,jsonb) TO authenticated;
CREATE FUNCTION public.read_web_offline_watch_duty_rules(p_vessel_id uuid,p_device_id text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',v,'revision',md5(v::text))) FROM (SELECT to_jsonb(r)||jsonb_build_object('id',r.vessel_id) v FROM public.watch_duty_rules r WHERE r.vessel_id=p_vessel_id) q),'[]'::jsonb);
 END; $$;
 REVOKE ALL ON FUNCTION public.read_web_offline_watch_duty_rules(uuid,text) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.read_web_offline_watch_duty_rules(uuid,text) TO authenticated;
CREATE FUNCTION public.sync_web_offline_watch_duty_rules(p_vessel_id uuid,p_device_id text,p_operation jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE op_id uuid;row_id uuid;v jsonb;old jsonb;item jsonb;receipt offline_private.record_receipts%ROWTYPE;
 BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR octet_length(p_operation::text)>260000 OR p_operation->>'feature' IS DISTINCT FROM 'watchDutyRules'
 OR p_operation->>'kind' IS NULL OR p_operation->>'kind' NOT IN('create','update') OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','recordId','feature','kind','value','baseRevision'))
 THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
 op_id:=(p_operation->>'id')::uuid;row_id:=(p_operation->>'recordId')::uuid;v:=p_operation->'value';
 IF op_id IS NULL OR row_id IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR v->>'id' IS DISTINCT FROM row_id::text OR v->>'vessel_id' IS DISTINCT FROM p_vessel_id::text
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','vessel_id','content','updated_at')) OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','vessel_id','content','updated_at']) k WHERE jsonb_typeof(v->k) IS DISTINCT FROM 'string')
 THEN RAISE EXCEPTION 'Invalid record' USING ERRCODE='22023'; END IF;
 IF row_id<>p_vessel_id THEN RAISE EXCEPTION 'Invalid rule identity' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||op_id::text,0));
 LOCK TABLE public.watch_duty_rules IN SHARE ROW EXCLUSIVE MODE;
 SELECT to_jsonb(r)||jsonb_build_object('id',r.vessel_id) INTO old FROM public.watch_duty_rules r WHERE r.vessel_id=row_id AND r.vessel_id=p_vessel_id;
 SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=op_id;
 IF FOUND THEN
 IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>'watchDutyRules' THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
 IF old IS NULL THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 ELSE
 IF NOT public.current_user_can_manage_vessel(p_vessel_id) THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 IF p_operation->>'kind'='create' THEN
 IF old IS NOT NULL OR p_operation->>'baseRevision' IS NOT NULL THEN RETURN jsonb_build_object('status','conflict'); END IF;
 ELSE
 IF old IS NULL THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 IF md5(old::text) IS DISTINCT FROM p_operation->>'baseRevision' THEN RETURN jsonb_build_object('status','conflict'); END IF;
 END IF;
 BEGIN
 IF old IS NULL THEN INSERT INTO public.watch_duty_rules(vessel_id,content) VALUES(p_vessel_id,v->>'content'); ELSE UPDATE public.watch_duty_rules SET content=v->>'content',updated_at=now() WHERE vessel_id=p_vessel_id;IF NOT FOUND THEN RAISE insufficient_privilege; END IF; END IF;
 INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash) VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'watchDutyRules',row_id,md5(p_operation::text));
 EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('status','forbidden'); WHEN unique_violation OR serialization_failure OR foreign_key_violation THEN RETURN jsonb_build_object('status','conflict'); END;
 SELECT to_jsonb(r)||jsonb_build_object('id',r.vessel_id) INTO old FROM public.watch_duty_rules r WHERE r.vessel_id=row_id AND r.vessel_id=p_vessel_id;
 END IF;
 RETURN jsonb_build_object('status','applied','operationId',op_id,'recordId',row_id,'value',old,'revision',md5(old::text));
 END; $$;
 GRANT CREATE ON SCHEMA public TO nautical_offline_writer;
 ALTER FUNCTION public.sync_web_offline_watch_duty_rules(uuid,text,jsonb) OWNER TO nautical_offline_writer;
 REVOKE CREATE ON SCHEMA public FROM nautical_offline_writer;
 REVOKE ALL ON FUNCTION public.sync_web_offline_watch_duty_rules(uuid,text,jsonb) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.sync_web_offline_watch_duty_rules(uuid,text,jsonb) TO authenticated;
CREATE FUNCTION public.read_web_offline_watch_duty_checks(p_vessel_id uuid,p_device_id text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',v,'revision',md5(v::text))) FROM (SELECT to_jsonb(r)||jsonb_build_object('id',r.item_id,'vessel_id',p_vessel_id) v FROM public.watch_duty_completions r WHERE r.user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.watch_duty_items i JOIN public.watch_duty_groups g ON g.id=i.group_id WHERE i.id=r.item_id AND g.vessel_id=p_vessel_id)) q),'[]'::jsonb);
 END; $$;
 REVOKE ALL ON FUNCTION public.read_web_offline_watch_duty_checks(uuid,text) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.read_web_offline_watch_duty_checks(uuid,text) TO authenticated;
CREATE FUNCTION public.sync_web_offline_watch_duty_checks(p_vessel_id uuid,p_device_id text,p_operation jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE op_id uuid;row_id uuid;v jsonb;old jsonb;item jsonb;receipt offline_private.record_receipts%ROWTYPE;
 BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR octet_length(p_operation::text)>260000 OR p_operation->>'feature' IS DISTINCT FROM 'watchDutyChecks'
 OR p_operation->>'kind' IS NULL OR p_operation->>'kind' NOT IN('create','update') OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','recordId','feature','kind','value','baseRevision'))
 THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
 op_id:=(p_operation->>'id')::uuid;row_id:=(p_operation->>'recordId')::uuid;v:=p_operation->'value';
 IF op_id IS NULL OR row_id IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR v->>'id' IS DISTINCT FROM row_id::text OR v->>'vessel_id' IS DISTINCT FROM p_vessel_id::text
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','vessel_id','user_id','item_id','checked','updated_at')) OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','vessel_id','user_id','item_id','updated_at']) k WHERE jsonb_typeof(v->k) IS DISTINCT FROM 'string')
 THEN RAISE EXCEPTION 'Invalid record' USING ERRCODE='22023'; END IF;
 IF v->>'item_id' IS DISTINCT FROM row_id::text OR v->>'user_id' IS DISTINCT FROM auth.uid()::text OR jsonb_typeof(v->'checked') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid personal checkmark' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||op_id::text,0));
 LOCK TABLE public.watch_duty_groups,public.watch_duty_items,public.watch_duty_completions IN SHARE ROW EXCLUSIVE MODE;
 SELECT to_jsonb(r)||jsonb_build_object('id',r.item_id,'vessel_id',p_vessel_id) INTO old FROM public.watch_duty_completions r WHERE r.item_id=row_id AND r.user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.watch_duty_items i JOIN public.watch_duty_groups g ON g.id=i.group_id WHERE i.id=r.item_id AND g.vessel_id=p_vessel_id);
 SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=op_id;
 IF FOUND THEN
 IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>'watchDutyChecks' THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
 IF old IS NULL THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 ELSE
 IF NOT EXISTS(SELECT 1 FROM public.watch_duty_items i JOIN public.watch_duty_groups g ON g.id=i.group_id WHERE i.id=row_id AND g.vessel_id=p_vessel_id) THEN RETURN jsonb_build_object('status','conflict'); END IF;
 IF p_operation->>'kind'='create' THEN
 IF old IS NOT NULL OR p_operation->>'baseRevision' IS NOT NULL THEN RETURN jsonb_build_object('status','conflict'); END IF;
 ELSE
 IF old IS NULL THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 IF md5(old::text) IS DISTINCT FROM p_operation->>'baseRevision' THEN RETURN jsonb_build_object('status','conflict'); END IF;
 END IF;
 BEGIN
 IF old IS NULL THEN INSERT INTO public.watch_duty_completions(user_id,item_id,checked) VALUES(auth.uid(),row_id,(v->>'checked')::boolean); ELSE UPDATE public.watch_duty_completions SET checked=(v->>'checked')::boolean,updated_at=now() WHERE user_id=auth.uid() AND item_id=row_id;IF NOT FOUND THEN RAISE insufficient_privilege; END IF; END IF;
 INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash) VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'watchDutyChecks',row_id,md5(p_operation::text));
 EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('status','forbidden'); WHEN unique_violation OR serialization_failure OR foreign_key_violation THEN RETURN jsonb_build_object('status','conflict'); END;
 SELECT to_jsonb(r)||jsonb_build_object('id',r.item_id,'vessel_id',p_vessel_id) INTO old FROM public.watch_duty_completions r WHERE r.item_id=row_id AND r.user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.watch_duty_items i JOIN public.watch_duty_groups g ON g.id=i.group_id WHERE i.id=r.item_id AND g.vessel_id=p_vessel_id);
 END IF;
 RETURN jsonb_build_object('status','applied','operationId',op_id,'recordId',row_id,'value',old,'revision',md5(old::text));
 END; $$;
 GRANT CREATE ON SCHEMA public TO nautical_offline_writer;
 ALTER FUNCTION public.sync_web_offline_watch_duty_checks(uuid,text,jsonb) OWNER TO nautical_offline_writer;
 REVOKE CREATE ON SCHEMA public FROM nautical_offline_writer;
 REVOKE ALL ON FUNCTION public.sync_web_offline_watch_duty_checks(uuid,text,jsonb) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.sync_web_offline_watch_duty_checks(uuid,text,jsonb) TO authenticated;
CREATE FUNCTION public.read_web_offline_watch_assignments(p_vessel_id uuid,p_device_id text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',v,'revision',md5(v::text))) FROM (SELECT to_jsonb(r) v FROM public.watch_assignments r WHERE r.vessel_id=p_vessel_id) q),'[]'::jsonb);
 END; $$;
 REVOKE ALL ON FUNCTION public.read_web_offline_watch_assignments(uuid,text) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.read_web_offline_watch_assignments(uuid,text) TO authenticated;
CREATE FUNCTION public.sync_web_offline_watch_assignments(p_vessel_id uuid,p_device_id text,p_operation jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE op_id uuid;row_id uuid;v jsonb;old jsonb;item jsonb;receipt offline_private.record_receipts%ROWTYPE;
 BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR octet_length(p_operation::text)>260000 OR p_operation->>'feature' IS DISTINCT FROM 'watchAssignments'
 OR p_operation->>'kind' IS NULL OR p_operation->>'kind' NOT IN('create','update') OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','recordId','feature','kind','value','baseRevision'))
 THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
 op_id:=(p_operation->>'id')::uuid;row_id:=(p_operation->>'recordId')::uuid;v:=p_operation->'value';
 IF op_id IS NULL OR row_id IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR v->>'id' IS DISTINCT FROM row_id::text OR v->>'vessel_id' IS DISTINCT FROM p_vessel_id::text
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','vessel_id','user_id','date','start_time','end_time','created_at')) OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','vessel_id','user_id','date','start_time','end_time','created_at']) k WHERE jsonb_typeof(v->k) IS DISTINCT FROM 'string')
 THEN RAISE EXCEPTION 'Invalid record' USING ERRCODE='22023'; END IF;
 IF (v->>'date')::date::text IS DISTINCT FROM v->>'date' OR v->>'start_time' !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' OR v->>'end_time' !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'Invalid watch date/time' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||op_id::text,0));
 LOCK TABLE public.watch_assignments IN SHARE ROW EXCLUSIVE MODE;
 SELECT to_jsonb(r) INTO old FROM public.watch_assignments r WHERE r.id=row_id AND r.vessel_id=p_vessel_id;
 SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=op_id;
 IF FOUND THEN
 IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>'watchAssignments' THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
 IF old IS NULL THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 ELSE
 IF NOT public.current_user_can_manage_vessel(p_vessel_id) THEN RETURN jsonb_build_object('status','forbidden'); END IF;IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=(v->>'user_id')::uuid AND vessel_id=p_vessel_id) THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 IF p_operation->>'kind'='create' THEN
 IF old IS NOT NULL OR p_operation->>'baseRevision' IS NOT NULL THEN RETURN jsonb_build_object('status','conflict'); END IF;
 ELSE
 IF old IS NULL THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 IF md5(old::text) IS DISTINCT FROM p_operation->>'baseRevision' THEN RETURN jsonb_build_object('status','conflict'); END IF;
 END IF;
 BEGIN
 IF old IS NULL THEN INSERT INTO public.watch_assignments(id,vessel_id,user_id,date,start_time,end_time) VALUES(row_id,p_vessel_id,(v->>'user_id')::uuid,(v->>'date')::date,v->>'start_time',v->>'end_time'); ELSE UPDATE public.watch_assignments SET user_id=(v->>'user_id')::uuid,date=(v->>'date')::date,start_time=v->>'start_time',end_time=v->>'end_time' WHERE id=row_id AND vessel_id=p_vessel_id;IF NOT FOUND THEN RAISE insufficient_privilege; END IF; END IF;
 INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash) VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'watchAssignments',row_id,md5(p_operation::text));
 EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('status','forbidden'); WHEN unique_violation OR serialization_failure OR foreign_key_violation THEN RETURN jsonb_build_object('status','conflict'); END;
 SELECT to_jsonb(r) INTO old FROM public.watch_assignments r WHERE r.id=row_id AND r.vessel_id=p_vessel_id;
 END IF;
 RETURN jsonb_build_object('status','applied','operationId',op_id,'recordId',row_id,'value',old,'revision',md5(old::text));
 END; $$;
 GRANT CREATE ON SCHEMA public TO nautical_offline_writer;
 ALTER FUNCTION public.sync_web_offline_watch_assignments(uuid,text,jsonb) OWNER TO nautical_offline_writer;
 REVOKE CREATE ON SCHEMA public FROM nautical_offline_writer;
 REVOKE ALL ON FUNCTION public.sync_web_offline_watch_assignments(uuid,text,jsonb) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.sync_web_offline_watch_assignments(uuid,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
