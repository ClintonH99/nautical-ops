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

-- The aggregate excludes trip display information: changing a trip name is not a checklist edit.
CREATE FUNCTION public.web_offline_checklist_record(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT to_jsonb(c)||jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.sort_order,i.id)
 FROM public.pre_departure_checklist_items i WHERE i.checklist_id=c.id),'[]'::jsonb))
 FROM public.pre_departure_checklists c WHERE c.id=p_id;
$$;
REVOKE ALL ON FUNCTION public.web_offline_checklist_record(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.web_offline_checklist_record(uuid) TO authenticated;
CREATE FUNCTION public.read_web_offline_checklists(p_vessel_id uuid,p_device_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',v,'revision',md5(v::text)))
 FROM (SELECT public.web_offline_checklist_record(id) v FROM public.pre_departure_checklists WHERE vessel_id=p_vessel_id ORDER BY created_at DESC) s),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.read_web_offline_checklists(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_checklists(uuid,text) TO authenticated;
CREATE FUNCTION public.sync_web_offline_checklist(p_vessel_id uuid,p_device_id text,p_operation jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op_id uuid; row_id uuid; v jsonb; old jsonb; item jsonb; item_id uuid; found_id uuid;
 receipt offline_private.record_receipts%ROWTYPE;
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR octet_length(p_operation::text)>260000
 OR p_operation->>'feature' IS DISTINCT FROM 'preDepartureChecklists'
 OR p_operation->>'kind' IS NULL OR p_operation->>'kind' NOT IN('create','update')
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','recordId','feature','kind','value','baseRevision'))
 THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
 op_id:=(p_operation->>'id')::uuid;row_id:=(p_operation->>'recordId')::uuid;v:=p_operation->'value';
 IF op_id IS NULL OR row_id IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object'
 OR v->>'id' IS DISTINCT FROM row_id::text OR v->>'vessel_id' IS DISTINCT FROM p_vessel_id::text
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','vessel_id','trip_id','department','title','created_at','created_by','items'))
 OR jsonb_typeof(v->'title') IS DISTINCT FROM 'string' OR length(trim(v->>'title'))=0
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['trip_id','department','created_by']) k WHERE NOT(v ? k) OR jsonb_typeof(v->k) NOT IN('string','null'))
 OR (v->>'department' IS NOT NULL AND v->>'department' NOT IN('BRIDGE','ENGINEERING','EXTERIOR','INTERIOR','GALLEY'))
 OR jsonb_typeof(v->'items') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Invalid checklist' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'items') i WHERE jsonb_typeof(i)<>'object') THEN RAISE EXCEPTION 'Invalid checklist items' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'items') i WHERE
  EXISTS(SELECT 1 FROM jsonb_object_keys(i) k WHERE k NOT IN('id','checklist_id','label','sort_order','checked','created_at')) OR
  EXISTS(SELECT 1 FROM unnest(ARRAY['id','checklist_id','label','created_at']) k WHERE jsonb_typeof(i->k) IS DISTINCT FROM 'string') OR
  i->>'checklist_id' IS DISTINCT FROM row_id::text OR jsonb_typeof(i->'sort_order') IS DISTINCT FROM 'number' OR
  jsonb_typeof(i->'checked') IS DISTINCT FROM 'boolean' OR (i->>'sort_order')::numeric <> trunc((i->>'sort_order')::numeric))
 OR (SELECT count(*)<>count(DISTINCT i->>'id') FROM jsonb_array_elements(v->'items') i)
 THEN RAISE EXCEPTION 'Invalid checklist items' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||op_id::text,0));
 SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=op_id;
 IF FOUND THEN
  IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>'preDepartureChecklists'
  THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
  old:=public.web_offline_checklist_record(row_id);
  IF old IS NULL THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 ELSE
  IF v->>'trip_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.trips WHERE id=(v->>'trip_id')::uuid AND vessel_id=p_vessel_id)
  THEN RETURN jsonb_build_object('status','conflict'); END IF;
  -- All writes and the receipt live in one subtransaction. A denied child write rolls back its parent.
  BEGIN
   IF p_operation->>'kind'='create' THEN
    IF p_operation->>'baseRevision' IS NOT NULL OR v->>'created_by' IS DISTINCT FROM auth.uid()::text
    THEN RAISE EXCEPTION 'Invalid create identity' USING ERRCODE='42501'; END IF;
    INSERT INTO public.pre_departure_checklists(id,vessel_id,trip_id,department,title,created_by)
    VALUES(row_id,p_vessel_id,(v->>'trip_id')::uuid,v->>'department',v->>'title',auth.uid())
    ON CONFLICT(id) DO NOTHING RETURNING id INTO found_id;
    IF found_id IS NULL THEN RAISE EXCEPTION 'Checklist exists' USING ERRCODE='40001'; END IF;
   ELSE
    PERFORM 1 FROM public.pre_departure_checklists WHERE id=row_id AND vessel_id=p_vessel_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
    PERFORM 1 FROM public.pre_departure_checklist_items WHERE checklist_id=row_id ORDER BY id FOR UPDATE;
    old:=public.web_offline_checklist_record(row_id);
    IF md5(old::text) IS DISTINCT FROM p_operation->>'baseRevision' THEN RETURN jsonb_build_object('status','conflict'); END IF;
    IF v->>'created_by' IS DISTINCT FROM old->>'created_by' THEN RAISE EXCEPTION 'Author changed' USING ERRCODE='42501'; END IF;
    -- Item deletion remains online. A concurrent new child is never removed by an older aggregate.
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(old->'items') i WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'items') n WHERE n->>'id'=i->>'id'))
    THEN RAISE EXCEPTION 'Item deletion requires online access' USING ERRCODE='42501'; END IF;
    UPDATE public.pre_departure_checklists SET title=v->>'title',trip_id=(v->>'trip_id')::uuid,department=v->>'department'
    WHERE id=row_id AND vessel_id=p_vessel_id RETURNING id INTO found_id;
    IF found_id IS NULL THEN RAISE EXCEPTION 'Checklist update denied' USING ERRCODE='42501'; END IF;
   END IF;
   FOR item IN SELECT * FROM jsonb_array_elements(v->'items') LOOP
    item_id:=(item->>'id')::uuid;
    IF p_operation->>'kind'='update' AND EXISTS(SELECT 1 FROM jsonb_array_elements(old->'items') i WHERE i->>'id'=item_id::text) THEN
     UPDATE public.pre_departure_checklist_items SET label=item->>'label',sort_order=(item->>'sort_order')::integer,checked=(item->>'checked')::boolean
      WHERE id=item_id AND checklist_id=row_id RETURNING id INTO found_id;
     IF found_id IS NULL THEN RAISE EXCEPTION 'Checklist item update denied' USING ERRCODE='42501'; END IF;
    ELSE
     INSERT INTO public.pre_departure_checklist_items(id,checklist_id,label,sort_order,checked)
      VALUES(item_id,row_id,item->>'label',(item->>'sort_order')::integer,(item->>'checked')::boolean);
    END IF;
   END LOOP;
   INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash)
   VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'preDepartureChecklists',row_id,md5(p_operation::text));
  EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('status','forbidden');
   WHEN unique_violation OR serialization_failure THEN RETURN jsonb_build_object('status','conflict');
  END;
  old:=public.web_offline_checklist_record(row_id);
 END IF;
 RETURN jsonb_build_object('status','applied','operationId',op_id,'recordId',row_id,'value',old,'revision',md5(old::text));
END; $$;
GRANT CREATE ON SCHEMA public TO nautical_offline_writer;
ALTER FUNCTION public.sync_web_offline_checklist(uuid,text,jsonb) OWNER TO nautical_offline_writer;
REVOKE CREATE ON SCHEMA public FROM nautical_offline_writer;
REVOKE ALL ON FUNCTION public.sync_web_offline_checklist(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_web_offline_checklist(uuid,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
