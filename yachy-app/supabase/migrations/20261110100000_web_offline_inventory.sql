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

CREATE FUNCTION public.read_web_offline_inventory_items(p_vessel_id uuid,p_device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',to_jsonb(s),
    'revision',md5(to_jsonb(s)::text)) ORDER BY s.created_at DESC)
    FROM public.inventory_items s WHERE s.vessel_id=p_vessel_id),'[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.read_web_offline_inventory_items(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_inventory_items(uuid,text) TO authenticated;

CREATE FUNCTION public.sync_web_offline_inventory_item(p_vessel_id uuid,p_device_id text,p_operation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  op_id uuid; row_id uuid; v jsonb; old public.inventory_items%ROWTYPE;
  receipt offline_private.record_receipts%ROWTYPE;
BEGIN
  PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
  IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR octet_length(p_operation::text)>260000
    OR p_operation->>'feature' IS DISTINCT FROM 'inventory'
    OR p_operation->>'kind' IS NULL OR p_operation->>'kind' NOT IN('create','update')
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','recordId','feature','kind','value','baseRevision'))
  THEN RAISE EXCEPTION 'Invalid offline operation' USING ERRCODE='22023'; END IF;
  op_id:=(p_operation->>'id')::uuid; row_id:=(p_operation->>'recordId')::uuid;
  v:=p_operation->'value';
  IF op_id IS NULL OR row_id IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object'
    OR v->>'id' IS DISTINCT FROM row_id::text OR v->>'vessel_id' IS DISTINCT FROM p_vessel_id::text
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','category_id','name','description','quantity','location','department','vessel_id','photo','last_edited_by','last_edited_by_name','last_edited_at','created_at','items','title'))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['name','location','department','last_edited_by_name','title']) k WHERE jsonb_typeof(v->k) IS DISTINCT FROM 'string')
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['category_id','description','photo','last_edited_by','last_edited_at','created_at']) k WHERE NOT(v ? k) OR jsonb_typeof(v->k) NOT IN('string','null'))
    OR v->>'department' NOT IN('BRIDGE','ENGINEERING','EXTERIOR','INTERIOR','GALLEY')
    OR length(trim(v->>'title'))=0 OR v->>'name' IS DISTINCT FROM v->>'title'
    OR jsonb_typeof(v->'quantity') IS DISTINCT FROM 'number'
    OR jsonb_typeof(v->'items') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Invalid inventory record' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'items') e WHERE jsonb_typeof(e) <> 'object') THEN
    RAISE EXCEPTION 'Invalid inventory rows' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'items') e WHERE
    EXISTS(SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN('amount','item')) OR
    EXISTS(SELECT 1 FROM unnest(ARRAY['amount','item']) k WHERE jsonb_typeof(e->k) IS DISTINCT FROM 'string')) THEN
    RAISE EXCEPTION 'Invalid inventory rows' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||op_id::text,0));
  SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=op_id;
  IF FOUND THEN
    IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id
      OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>'inventory'
    THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
    SELECT * INTO old FROM public.inventory_items WHERE id=row_id AND vessel_id=p_vessel_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  ELSIF p_operation->>'kind'='create' THEN
    IF p_operation->>'baseRevision' IS NOT NULL OR v->>'category_id' IS NOT NULL OR v->>'photo' IS NOT NULL OR (v->>'quantity')::numeric <> 0
    THEN RAISE EXCEPTION 'Invalid create identity' USING ERRCODE='42501'; END IF;
    INSERT INTO public.inventory_items(id,vessel_id,name,title,department,location,description,items,last_edited_by,last_edited_by_name)
      VALUES(row_id,p_vessel_id,v->>'title',v->>'title',v->>'department',v->>'location',v->>'description',v->'items',auth.uid(),coalesce((SELECT name FROM public.users WHERE id=auth.uid()),'Unknown'))
      ON CONFLICT(id) DO NOTHING RETURNING * INTO old;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','conflict'); END IF;
    INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash)
      VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'inventory',row_id,md5(p_operation::text));
  ELSE
    SELECT * INTO old FROM public.inventory_items WHERE id=row_id AND vessel_id=p_vessel_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
    IF md5(to_jsonb(old)::text) IS DISTINCT FROM p_operation->>'baseRevision'
    THEN RETURN jsonb_build_object('status','conflict'); END IF;
    IF v->>'category_id' IS DISTINCT FROM old.category_id::text OR v->>'photo' IS DISTINCT FROM old.photo
      OR (v->>'quantity')::numeric IS DISTINCT FROM old.quantity THEN RAISE EXCEPTION 'Unsupported inventory field change' USING ERRCODE='42501'; END IF;
    UPDATE public.inventory_items SET name=v->>'title',title=v->>'title',department=v->>'department',location=v->>'location',description=v->>'description',items=v->'items',last_edited_by=auth.uid(),last_edited_by_name=coalesce((SELECT name FROM public.users WHERE id=auth.uid()),'Unknown'),last_edited_at=clock_timestamp()
      WHERE id=row_id AND vessel_id=p_vessel_id RETURNING * INTO old;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
    INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash)
      VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'inventory',row_id,md5(p_operation::text));
  END IF;
  RETURN jsonb_build_object('status','applied','operationId',op_id,'recordId',row_id,
    'value',to_jsonb(old),'revision',md5(to_jsonb(old)::text));
END;
$$;
GRANT CREATE ON SCHEMA public TO nautical_offline_writer;
ALTER FUNCTION public.sync_web_offline_inventory_item(uuid,text,jsonb) OWNER TO nautical_offline_writer;
REVOKE CREATE ON SCHEMA public FROM nautical_offline_writer;
REVOKE ALL ON FUNCTION public.sync_web_offline_inventory_item(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_web_offline_inventory_item(uuid,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
