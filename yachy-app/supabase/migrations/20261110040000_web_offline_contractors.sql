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
      'contractors',jsonb_build_array('read','create','update')));
END;
$$;
REVOKE ALL ON FUNCTION public.get_web_offline_context(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_web_offline_context(uuid,text) TO authenticated;

CREATE FUNCTION public.read_web_offline_contractors(p_vessel_id uuid,p_device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',to_jsonb(s),
    'revision',md5(to_jsonb(s)::text)) ORDER BY s.created_at DESC)
    FROM public.contractors s WHERE s.vessel_id=p_vessel_id),'[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.read_web_offline_contractors(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_contractors(uuid,text) TO authenticated;

CREATE FUNCTION public.sync_web_offline_contractor(p_vessel_id uuid,p_device_id text,p_operation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  op_id uuid; row_id uuid; v jsonb; old public.contractors%ROWTYPE;
  receipt offline_private.record_receipts%ROWTYPE;
BEGIN
  PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
  IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR octet_length(p_operation::text)>260000
    OR p_operation->>'feature' IS DISTINCT FROM 'contractors'
    OR p_operation->>'kind' IS NULL OR p_operation->>'kind' NOT IN('create','update')
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','recordId','feature','kind','value','baseRevision'))
  THEN RAISE EXCEPTION 'Invalid offline operation' USING ERRCODE='22023'; END IF;
  op_id:=(p_operation->>'id')::uuid; row_id:=(p_operation->>'recordId')::uuid;
  v:=p_operation->'value';
  IF op_id IS NULL OR row_id IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object'
    OR v->>'id' IS DISTINCT FROM row_id::text OR v->>'vessel_id' IS DISTINCT FROM p_vessel_id::text
    OR jsonb_typeof(v->'company_name') IS DISTINCT FROM 'string' OR length(trim(v->>'company_name'))=0
    OR v->>'department' IS NULL OR v->>'department' NOT IN('BRIDGE','ENGINEERING','EXTERIOR','INTERIOR','GALLEY')
    OR jsonb_typeof(v->'contacts') IS DISTINCT FROM 'array'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','vessel_id','department','company_name','company_address','description','known_for','contacts','created_by','created_at'))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['company_address','description','known_for','created_by']) k
      WHERE NOT(v ? k) OR jsonb_typeof(v->k) NOT IN('string','null'))
  THEN RAISE EXCEPTION 'Invalid contractor' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'contacts') c WHERE jsonb_typeof(c) IS DISTINCT FROM 'object'
    OR jsonb_typeof(c->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(c->'mobile') IS DISTINCT FROM 'string'
    OR jsonb_typeof(c->'email') IS DISTINCT FROM 'string'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(c) k WHERE k NOT IN('name','mobile','email')))
  THEN RAISE EXCEPTION 'Invalid contractor contacts' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||op_id::text,0));
  SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=op_id;
  IF FOUND THEN
    IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id
      OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>'contractors'
    THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
    SELECT * INTO old FROM public.contractors WHERE id=row_id AND vessel_id=p_vessel_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  ELSIF p_operation->>'kind'='create' THEN
    IF p_operation->>'baseRevision' IS NOT NULL OR v->>'created_by' IS DISTINCT FROM auth.uid()::text
    THEN RAISE EXCEPTION 'Invalid create identity' USING ERRCODE='42501'; END IF;
    INSERT INTO public.contractors(id,vessel_id,department,company_name,company_address,description,known_for,contacts,created_by)
      VALUES(row_id,p_vessel_id,v->>'department',trim(v->>'company_name'),v->>'company_address',v->>'description',v->>'known_for',v->'contacts',auth.uid())
      ON CONFLICT(id) DO NOTHING RETURNING * INTO old;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','conflict'); END IF;
    INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash)
      VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'contractors',row_id,md5(p_operation::text));
  ELSE
    SELECT * INTO old FROM public.contractors WHERE id=row_id AND vessel_id=p_vessel_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
    IF md5(to_jsonb(old)::text) IS DISTINCT FROM p_operation->>'baseRevision'
    THEN RETURN jsonb_build_object('status','conflict'); END IF;
    IF v->>'created_by' IS DISTINCT FROM old.created_by::text
    THEN RAISE EXCEPTION 'Immutable contractor creator' USING ERRCODE='42501'; END IF;
    UPDATE public.contractors SET company_name=trim(v->>'company_name'),company_address=v->>'company_address',
      description=v->>'description',known_for=v->>'known_for',contacts=v->'contacts',department=v->>'department'
      WHERE id=row_id AND vessel_id=p_vessel_id RETURNING * INTO old;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
    INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash)
      VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'contractors',row_id,md5(p_operation::text));
  END IF;
  RETURN jsonb_build_object('status','applied','operationId',op_id,'recordId',row_id,
    'value',to_jsonb(old),'revision',md5(to_jsonb(old)::text));
END;
$$;
GRANT CREATE ON SCHEMA public TO nautical_offline_writer;
ALTER FUNCTION public.sync_web_offline_contractor(uuid,text,jsonb) OWNER TO nautical_offline_writer;
REVOKE CREATE ON SCHEMA public FROM nautical_offline_writer;
REVOKE ALL ON FUNCTION public.sync_web_offline_contractor(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_web_offline_contractor(uuid,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
