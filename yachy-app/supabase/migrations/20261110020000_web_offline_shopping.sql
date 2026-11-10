BEGIN;
-- A non-login, non-owner role keeps existing table RLS and triggers in force.
-- It can write receipts inside this transaction, but app roles cannot forge them.
CREATE ROLE nautical_offline_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
GRANT authenticated TO nautical_offline_writer;
GRANT USAGE ON SCHEMA public, auth, offline_private TO nautical_offline_writer;
CREATE TABLE offline_private.record_receipts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL, vessel_id uuid NOT NULL, device_id text NOT NULL,
  feature text NOT NULL, record_id uuid NOT NULL, request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,operation_id)
);
ALTER TABLE offline_private.record_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offline_private.record_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON offline_private.record_receipts TO nautical_offline_writer;
CREATE POLICY writer_receipts ON offline_private.record_receipts TO nautical_offline_writer
  USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());

CREATE FUNCTION public.read_web_offline_shopping(p_vessel_id uuid,p_device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',to_jsonb(s),
    'revision',md5(to_jsonb(s)::text)) ORDER BY s.created_at DESC)
    FROM public.shopping_lists s WHERE s.vessel_id=p_vessel_id),'[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.read_web_offline_shopping(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_shopping(uuid,text) TO authenticated;

CREATE FUNCTION public.sync_web_offline_shopping(p_vessel_id uuid,p_device_id text,p_operation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  op_id uuid; row_id uuid; v jsonb; old public.shopping_lists%ROWTYPE;
  receipt offline_private.record_receipts%ROWTYPE;
BEGIN
  PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
  IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR octet_length(p_operation::text)>260000
    OR p_operation->>'feature' IS DISTINCT FROM 'shoppingLists'
    OR p_operation->>'kind' IS NULL OR p_operation->>'kind' NOT IN('create','update')
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','recordId','feature','kind','value','baseRevision'))
  THEN RAISE EXCEPTION 'Invalid offline operation' USING ERRCODE='22023'; END IF;
  op_id:=(p_operation->>'id')::uuid; row_id:=(p_operation->>'recordId')::uuid;
  v:=p_operation->'value';
  IF op_id IS NULL OR row_id IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object'
    OR v->>'id' IS DISTINCT FROM row_id::text OR v->>'vessel_id' IS DISTINCT FROM p_vessel_id::text
    OR jsonb_typeof(v->'title') IS DISTINCT FROM 'string' OR length(trim(v->>'title'))=0
    OR jsonb_typeof(v->'items') IS DISTINCT FROM 'array' OR jsonb_typeof(v->'is_master') IS DISTINCT FROM 'boolean'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','vessel_id','department','title','items','created_at','created_by','list_type','is_master'))
  THEN RAISE EXCEPTION 'Invalid shopping list' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'items') item WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
    OR jsonb_typeof(item->'text') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'checked') IS DISTINCT FROM 'boolean'
    OR (item ? 'amount' AND jsonb_typeof(item->'amount') IS DISTINCT FROM 'string')
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN('text','amount','checked')))
  THEN RAISE EXCEPTION 'Invalid shopping items' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||op_id::text,0));
  SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=op_id;
  IF FOUND THEN
    IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id
      OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>'shoppingLists'
    THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
    SELECT * INTO old FROM public.shopping_lists WHERE id=row_id AND vessel_id=p_vessel_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  ELSIF p_operation->>'kind'='create' THEN
    IF p_operation->>'baseRevision' IS NOT NULL OR v->>'created_by' IS DISTINCT FROM auth.uid()::text
    THEN RAISE EXCEPTION 'Invalid create identity' USING ERRCODE='42501'; END IF;
    INSERT INTO public.shopping_lists(id,vessel_id,department,title,items,created_by,list_type,is_master)
      VALUES(row_id,p_vessel_id,v->>'department',trim(v->>'title'),v->'items',auth.uid(),v->>'list_type',(v->>'is_master')::boolean)
      ON CONFLICT(id) DO NOTHING RETURNING * INTO old;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','conflict'); END IF;
    INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash)
      VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'shoppingLists',row_id,md5(p_operation::text));
  ELSE
    SELECT * INTO old FROM public.shopping_lists WHERE id=row_id AND vessel_id=p_vessel_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
    IF md5(to_jsonb(old)::text) IS DISTINCT FROM p_operation->>'baseRevision'
    THEN RETURN jsonb_build_object('status','conflict'); END IF;
    -- Match the existing service: edits change only title and items.
    IF v->>'department' IS DISTINCT FROM old.department OR v->>'list_type' IS DISTINCT FROM old.list_type
      OR (v->>'is_master')::boolean IS DISTINCT FROM old.is_master
      OR v->>'created_by' IS DISTINCT FROM old.created_by::text
    THEN RAISE EXCEPTION 'Immutable shopping fields' USING ERRCODE='42501'; END IF;
    UPDATE public.shopping_lists SET title=trim(v->>'title'),items=v->'items'
      WHERE id=row_id AND vessel_id=p_vessel_id RETURNING * INTO old;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
    INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash)
      VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'shoppingLists',row_id,md5(p_operation::text));
  END IF;
  RETURN jsonb_build_object('status','applied','operationId',op_id,'recordId',row_id,
    'value',to_jsonb(old),'revision',md5(to_jsonb(old)::text));
END;
$$;
-- Ownership transfer does not grant this role to app users or allow login.
GRANT nautical_offline_writer TO postgres;
GRANT CREATE ON SCHEMA public TO nautical_offline_writer;
ALTER FUNCTION public.sync_web_offline_shopping(uuid,text,jsonb) OWNER TO nautical_offline_writer;
GRANT SELECT,INSERT ON offline_private.note_receipts TO nautical_offline_writer;
CREATE POLICY writer_note_receipts ON offline_private.note_receipts TO nautical_offline_writer
  USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
ALTER FUNCTION public.sync_web_offline_note(uuid,text,jsonb) OWNER TO nautical_offline_writer;
REVOKE CREATE ON SCHEMA public FROM nautical_offline_writer;
REVOKE ALL ON FUNCTION public.sync_web_offline_shopping(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_web_offline_shopping(uuid,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
