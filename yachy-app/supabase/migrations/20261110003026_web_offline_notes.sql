-- Additive offline protocol. Does not change existing billing or device policies.
BEGIN;
CREATE SCHEMA IF NOT EXISTS offline_private;
REVOKE ALL ON SCHEMA offline_private FROM PUBLIC, anon, authenticated;
CREATE TABLE offline_private.note_receipts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, operation_id uuid NOT NULL,
  vessel_id uuid NOT NULL, session_id uuid NOT NULL, device_id text NOT NULL,
  request_hash text NOT NULL, record_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation_id)
);
ALTER TABLE offline_private.note_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offline_private.note_receipts FROM PUBLIC, anon, authenticated;

-- Controlled lookup needs auth.sessions and device/subscription internals.
-- No client-supplied role, subscription state or timestamps are trusted.
CREATE FUNCTION public.get_web_offline_context(p_vessel_id uuid, p_device_id text)
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
      'shoppingLists',jsonb_build_array('read','create','update')));
END;
$$;
REVOKE ALL ON FUNCTION public.get_web_offline_context(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_web_offline_context(uuid,text) TO authenticated;

CREATE FUNCTION public.read_web_offline_notes(p_vessel_id uuid, p_device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',to_jsonb(n),
    'revision',md5(to_jsonb(n)::text)) ORDER BY n.updated_at DESC)
    FROM public.notes n WHERE n.user_id = auth.uid() AND n.vessel_id = p_vessel_id),'[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.read_web_offline_notes(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_notes(uuid,text) TO authenticated;

-- Definer is limited to own notes and private receipts, with the same own-user
-- plus current-vessel-access predicates as notes RLS. Explicit columns only.
CREATE FUNCTION public.sync_web_offline_note(p_vessel_id uuid,p_device_id text,p_operation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  context jsonb; op_id uuid; note_id uuid; existing public.notes%ROWTYPE;
  receipt offline_private.note_receipts%ROWTYPE; result jsonb; value jsonb;
BEGIN
  context := public.get_web_offline_context(p_vessel_id,p_device_id);
  IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR octet_length(p_operation::text)>260000
    OR p_operation->>'feature' IS DISTINCT FROM 'notes'
    OR p_operation->>'kind' NOT IN ('create','update')
    OR p_operation->>'kind' IS NULL
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN
      ('id','recordId','kind','feature','value','baseRevision'))
  THEN RAISE EXCEPTION 'Invalid offline operation' USING ERRCODE='22023'; END IF;
  op_id := (p_operation->>'id')::uuid; note_id := (p_operation->>'recordId')::uuid;
  IF op_id IS NULL OR note_id IS NULL THEN RAISE EXCEPTION 'Missing operation ID'; END IF;
  value := p_operation->'value';
  IF jsonb_typeof(value) IS DISTINCT FROM 'object'
    OR value->>'user_id' IS DISTINCT FROM auth.uid()::text
    OR value->>'vessel_id' IS DISTINCT FROM p_vessel_id::text
    OR value->>'id' IS DISTINCT FROM note_id::text
    OR jsonb_typeof(value->'title') IS DISTINCT FROM 'string'
    OR jsonb_typeof(value->'content') IS DISTINCT FROM 'string'
    OR jsonb_typeof(value->'created_by_name') IS DISTINCT FROM 'string'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(value) k WHERE k NOT IN
      ('id','vessel_id','user_id','title','content','created_by_name','created_at','updated_at'))
  THEN RAISE EXCEPTION 'Invalid private note' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||op_id::text,0));
  SELECT * INTO receipt FROM offline_private.note_receipts
    WHERE user_id=auth.uid() AND operation_id=op_id;
  IF FOUND THEN
    IF receipt.request_hash <> md5(p_operation::text) OR receipt.vessel_id<>p_vessel_id
      OR receipt.device_id<>p_device_id
    THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
    SELECT * INTO existing FROM public.notes WHERE id=receipt.record_id
      AND user_id=auth.uid() AND vessel_id=p_vessel_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
    RETURN jsonb_build_object('status','applied','operationId',op_id,'recordId',note_id,
      'revision',md5(to_jsonb(existing)::text),'value',to_jsonb(existing));
  END IF;
  IF p_operation->>'kind' = 'create' THEN
    IF p_operation->>'baseRevision' IS NOT NULL THEN RAISE EXCEPTION 'Invalid create base'; END IF;
    INSERT INTO public.notes(id,vessel_id,user_id,title,content,created_by_name)
      VALUES(note_id,p_vessel_id,auth.uid(),value->>'title',value->>'content',value->>'created_by_name')
      ON CONFLICT(id) DO NOTHING RETURNING * INTO existing;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','conflict'); END IF;
  ELSE
    SELECT * INTO existing FROM public.notes WHERE id=note_id AND user_id=auth.uid()
      AND vessel_id=p_vessel_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
    IF md5(to_jsonb(existing)::text) IS DISTINCT FROM p_operation->>'baseRevision'
    THEN RETURN jsonb_build_object('status','conflict'); END IF;
    UPDATE public.notes SET title=value->>'title',content=value->>'content',updated_at=clock_timestamp()
      WHERE id=note_id AND user_id=auth.uid() AND vessel_id=p_vessel_id RETURNING * INTO existing;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  END IF;
  result := jsonb_build_object('status','applied','operationId',op_id,'recordId',note_id,
    'revision',md5(to_jsonb(existing)::text),'value',to_jsonb(existing));
  INSERT INTO offline_private.note_receipts(user_id,operation_id,vessel_id,session_id,device_id,request_hash,record_id)
    VALUES(auth.uid(),op_id,p_vessel_id,(context->>'sessionId')::uuid,p_device_id,md5(p_operation::text),note_id);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_web_offline_note(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_web_offline_note(uuid,text,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
