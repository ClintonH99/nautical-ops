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

CREATE FUNCTION public.read_web_offline_shipyard_folders(p_vessel_id uuid,p_device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
  RETURN jsonb_build_object('folders',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.name) FROM public.shipyard_record_folders f WHERE f.vessel_id=p_vessel_id),'[]'::jsonb),
    'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('job_id',i.job_id,'folder_id',i.folder_id)) FROM public.shipyard_record_folder_items i JOIN public.yard_period_jobs j ON j.id=i.job_id WHERE j.vessel_id=p_vessel_id),'[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.read_web_offline_shipyard_folders(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_shipyard_folders(uuid,text) TO authenticated;

CREATE FUNCTION public.read_web_offline_yard_jobs(p_vessel_id uuid,p_device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',to_jsonb(s),
    'revision',md5(to_jsonb(s)::text)) ORDER BY s.created_at DESC)
    FROM public.yard_period_jobs s WHERE s.vessel_id=p_vessel_id),'[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.read_web_offline_yard_jobs(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_yard_jobs(uuid,text) TO authenticated;

CREATE FUNCTION public.sync_web_offline_yard_job(p_vessel_id uuid,p_device_id text,p_operation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  op_id uuid; row_id uuid; v jsonb; old public.yard_period_jobs%ROWTYPE;
  receipt offline_private.record_receipts%ROWTYPE;
BEGIN
  PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
  IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR octet_length(p_operation::text)>260000
    OR p_operation->>'feature' IS DISTINCT FROM 'yardJobs'
    OR p_operation->>'kind' IS NULL OR p_operation->>'kind' NOT IN('create','update')
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','recordId','feature','kind','value','baseRevision'))
  THEN RAISE EXCEPTION 'Invalid offline operation' USING ERRCODE='22023'; END IF;
  op_id:=(p_operation->>'id')::uuid; row_id:=(p_operation->>'recordId')::uuid;
  v:=p_operation->'value';
  IF op_id IS NULL OR row_id IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object'
    OR v->>'id' IS DISTINCT FROM row_id::text OR v->>'vessel_id' IS DISTINCT FROM p_vessel_id::text
    OR jsonb_typeof(v->'job_title') IS DISTINCT FROM 'string' OR length(trim(v->>'job_title'))=0
    OR v->>'status' IS NULL OR v->>'status' NOT IN('NOT_STARTED','IN_PROGRESS','COMPLETED')
    OR v->>'department' IS NULL OR v->>'department' NOT IN('BRIDGE','ENGINEERING','EXTERIOR','INTERIOR','GALLEY')
    OR v->>'priority' IS NULL OR v->>'priority' NOT IN('GREEN','YELLOW','RED')
    OR NOT(v ? 'start_date') OR NOT(v ? 'end_date')
    OR ((v->>'start_date' IS NULL) <> (v->>'end_date' IS NULL))
    OR (v->>'start_date' IS NOT NULL AND (v->>'start_date' !~ '^\d{4}-\d{2}-\d{2}$' OR v->>'end_date' !~ '^\d{4}-\d{2}-\d{2}$' OR (v->>'end_date')::date < (v->>'start_date')::date))
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','vessel_id','job_title','job_description','yard_location','contractor_company_name','contact_details','done_by_date','status','completed_by','completed_at','completed_by_name','created_by','created_at','updated_at','department','priority','trip_id','defect_details','defect_location','equipment_serial','start_date','end_date'))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['job_description','yard_location','contractor_company_name','contact_details','done_by_date','completed_by','completed_at','completed_by_name','created_by','trip_id','defect_details','defect_location','equipment_serial']) k WHERE NOT(v ? k) OR jsonb_typeof(v->k) NOT IN('string','null'))
  THEN RAISE EXCEPTION 'Invalid shipyard job' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||op_id::text,0));
  SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=op_id;
  IF FOUND THEN
    IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id
      OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>'yardJobs'
    THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
    SELECT * INTO old FROM public.yard_period_jobs WHERE id=row_id AND vessel_id=p_vessel_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
  ELSIF p_operation->>'kind'='create' THEN
    IF p_operation->>'baseRevision' IS NOT NULL OR v->>'created_by' IS DISTINCT FROM auth.uid()::text
      OR v->>'done_by_date' IS NOT NULL
      OR (v->>'status'='COMPLETED' AND (v->>'completed_by' IS DISTINCT FROM auth.uid()::text OR v->>'completed_at' IS NULL OR v->>'completed_by_name' IS NULL))
      OR (v->>'status'<>'COMPLETED' AND (v->>'completed_by' IS NOT NULL OR v->>'completed_at' IS NOT NULL OR v->>'completed_by_name' IS NOT NULL))
    THEN RAISE EXCEPTION 'Invalid create identity' USING ERRCODE='42501'; END IF;
    IF v->>'trip_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.trips WHERE id=(v->>'trip_id')::uuid AND vessel_id=p_vessel_id) THEN
      RAISE EXCEPTION 'Linked trip is not accessible on this vessel' USING ERRCODE='42501'; END IF;
    INSERT INTO public.yard_period_jobs(id,vessel_id,job_title,job_description,yard_location,contractor_company_name,contact_details,status,completed_by,completed_at,completed_by_name,created_by,department,priority,trip_id,defect_details,defect_location,equipment_serial,start_date,end_date)
      VALUES(row_id,p_vessel_id,trim(v->>'job_title'),v->>'job_description',v->>'yard_location',v->>'contractor_company_name',v->>'contact_details',v->>'status',(v->>'completed_by')::uuid,(v->>'completed_at')::timestamptz,v->>'completed_by_name',auth.uid(),v->>'department',v->>'priority',(v->>'trip_id')::uuid,v->>'defect_details',v->>'defect_location',v->>'equipment_serial',(v->>'start_date')::date,(v->>'end_date')::date)
      ON CONFLICT(id) DO NOTHING RETURNING * INTO old;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','conflict'); END IF;
    INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash)
      VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'yardJobs',row_id,md5(p_operation::text));
  ELSE
    SELECT * INTO old FROM public.yard_period_jobs WHERE id=row_id AND vessel_id=p_vessel_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
    IF md5(to_jsonb(old)::text) IS DISTINCT FROM p_operation->>'baseRevision'
    THEN RETURN jsonb_build_object('status','conflict'); END IF;
    IF v->>'created_by' IS DISTINCT FROM old.created_by::text OR v->>'trip_id' IS DISTINCT FROM old.trip_id::text OR v->>'done_by_date' IS DISTINCT FROM old.done_by_date
    THEN RAISE EXCEPTION 'Immutable shipyard job identity' USING ERRCODE='42501'; END IF;
    IF old.status='COMPLETED' THEN
      -- Reopening is deliberately left to the existing manager-only online RPC.
      IF v->>'status'<>'COMPLETED' OR v->>'completed_by' IS DISTINCT FROM old.completed_by::text
        OR (v->>'completed_at')::timestamptz IS DISTINCT FROM old.completed_at
        OR v->>'completed_by_name' IS DISTINCT FROM old.completed_by_name
      THEN RAISE EXCEPTION 'Completed shipyard record requires online management' USING ERRCODE='42501'; END IF;
    ELSIF v->>'status'='COMPLETED' THEN
      IF v->>'completed_by' IS DISTINCT FROM auth.uid()::text OR v->>'completed_at' IS NULL
        OR v->>'completed_by_name' IS NULL
      THEN RAISE EXCEPTION 'Invalid completion identity' USING ERRCODE='42501'; END IF;
    ELSIF v->>'completed_by' IS NOT NULL OR v->>'completed_at' IS NOT NULL OR v->>'completed_by_name' IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid active job completion' USING ERRCODE='22023';
    END IF;
    UPDATE public.yard_period_jobs SET job_title=trim(v->>'job_title'),job_description=v->>'job_description',yard_location=v->>'yard_location',contractor_company_name=v->>'contractor_company_name',contact_details=v->>'contact_details',status=v->>'status',completed_by=(v->>'completed_by')::uuid,completed_at=(v->>'completed_at')::timestamptz,completed_by_name=v->>'completed_by_name',department=v->>'department',priority=v->>'priority',defect_details=v->>'defect_details',defect_location=v->>'defect_location',equipment_serial=v->>'equipment_serial',start_date=(v->>'start_date')::date,end_date=(v->>'end_date')::date,updated_at=now()
      WHERE id=row_id AND vessel_id=p_vessel_id RETURNING * INTO old;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','forbidden'); END IF;
    INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash)
      VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,'yardJobs',row_id,md5(p_operation::text));
  END IF;
  RETURN jsonb_build_object('status','applied','operationId',op_id,'recordId',row_id,
    'value',to_jsonb(old),'revision',md5(to_jsonb(old)::text));
END;
$$;
GRANT CREATE ON SCHEMA public TO nautical_offline_writer;
ALTER FUNCTION public.sync_web_offline_yard_job(uuid,text,jsonb) OWNER TO nautical_offline_writer;
REVOKE CREATE ON SCHEMA public FROM nautical_offline_writer;
REVOKE ALL ON FUNCTION public.sync_web_offline_yard_job(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_web_offline_yard_job(uuid,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
