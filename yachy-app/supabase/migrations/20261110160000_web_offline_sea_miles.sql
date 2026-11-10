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
      'seaMiles',jsonb_build_array('read','create','update'),
      'seaMilesReview',CASE WHEN public.current_user_is_captain_of(p_vessel_id) THEN jsonb_build_array('read','update') ELSE '[]'::jsonb END,
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



CREATE FUNCTION public.web_offline_sea_review_revision() RETURNS text
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT md5(jsonb_build_object('signature',(SELECT to_jsonb(s) FROM public.user_signatures s WHERE user_id=auth.uid()),'contact',(SELECT to_jsonb(c) FROM public.captain_sea_mile_contacts c WHERE user_id=auth.uid()))::text);
$$;
REVOKE ALL ON FUNCTION public.web_offline_sea_review_revision() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.web_offline_sea_review_revision() TO authenticated;
CREATE FUNCTION public.read_web_offline_sea_context(p_vessel_id uuid,p_device_id text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 RETURN jsonb_build_object('folders',coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM public.sea_mile_folders f WHERE user_id=auth.uid()),'[]'::jsonb),
 'assignments',coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM public.sea_mile_folder_items i),'[]'::jsonb),
 'contact',(SELECT to_jsonb(c) FROM public.captain_sea_mile_contacts c WHERE user_id=auth.uid()),
 'canSubmit',EXISTS(SELECT 1 FROM public.users WHERE vessel_id=p_vessel_id AND role='CAPTAIN_MOV'),
 'hasSignature',EXISTS(SELECT 1 FROM public.user_signatures WHERE user_id=auth.uid()),'reviewRevision',public.web_offline_sea_review_revision());
 END; $$;
REVOKE ALL ON FUNCTION public.read_web_offline_sea_context(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_sea_context(uuid,text) TO authenticated;
CREATE FUNCTION public.read_web_offline_sea_miles(p_vessel_id uuid,p_device_id text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',to_jsonb(r)||jsonb_build_object('review_context_revision',NULL),'revision',md5(to_jsonb(r)::text))) FROM public.sea_mile_entries r WHERE r.user_id=auth.uid()),'[]'::jsonb);
 END; $$;
 REVOKE ALL ON FUNCTION public.read_web_offline_sea_miles(uuid,text) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.read_web_offline_sea_miles(uuid,text) TO authenticated;
CREATE FUNCTION public.read_web_offline_sea_miles_review(p_vessel_id uuid,p_device_id text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);IF NOT public.current_user_is_captain_of(p_vessel_id) THEN RAISE insufficient_privilege; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('value',to_jsonb(r)||jsonb_build_object('review_context_revision',NULL),'revision',md5(to_jsonb(r)::text))) FROM public.sea_mile_entries r WHERE r.user_id<>auth.uid() AND r.review_vessel_id=p_vessel_id),'[]'::jsonb);
 END; $$;
 REVOKE ALL ON FUNCTION public.read_web_offline_sea_miles_review(uuid,text) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.read_web_offline_sea_miles_review(uuid,text) TO authenticated;
CREATE FUNCTION public.sync_web_offline_sea_miles(p_vessel_id uuid,p_device_id text,p_operation jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE op_id uuid;row_id uuid;v jsonb;old jsonb;receipt offline_private.record_receipts%ROWTYPE;f text;
 BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 f:=p_operation->>'feature';
 IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR octet_length(p_operation::text)>260000 OR f IS NULL OR f NOT IN('seaMiles','seaMilesReview') OR p_operation->>'kind' IS NULL OR p_operation->>'kind' NOT IN('create','update')
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','recordId','feature','kind','value','baseRevision')) THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
 op_id:=(p_operation->>'id')::uuid;row_id:=(p_operation->>'recordId')::uuid;v:=p_operation->'value';
 IF op_id IS NULL OR row_id IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR v->>'id' IS DISTINCT FROM row_id::text OR v->>'user_id' IS NULL
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','user_id','voyage_date','vessel_name','vessel_length','from_location','to_location','capacity_role','miles_logged','day_hours','night_hours','tidal','owner_name','review_vessel_id','submitted_at','reviewed_by','reviewer_name','reviewer_signature_type','reviewer_signature_image','reviewer_typed_name','reviewed_at','created_at','updated_at','reviewer_contact_first_name','reviewer_contact_last_name','reviewer_contact_cell_number','reviewer_contact_email_address','status','decline_comment','review_context_revision'))
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['voyage_date','vessel_name','vessel_length','from_location','to_location','capacity_role','status']) k WHERE jsonb_typeof(v->k) IS DISTINCT FROM 'string')
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['miles_logged','day_hours','night_hours']) k WHERE jsonb_typeof(v->k) IS DISTINCT FROM 'number' OR (v->>k)::numeric<0)
 OR jsonb_typeof(v->'tidal') IS DISTINCT FROM 'boolean' OR v->>'status' NOT IN('DRAFT','PENDING','APPROVED','DECLINED')
 OR (v->>'voyage_date')::date::text IS DISTINCT FROM v->>'voyage_date'
 THEN RAISE EXCEPTION 'Invalid sea-mile record' USING ERRCODE='22023'; END IF;
 IF (f='seaMiles' AND v->>'user_id' IS DISTINCT FROM auth.uid()::text) OR (f='seaMilesReview' AND (v->>'user_id'=auth.uid()::text OR NOT public.current_user_is_captain_of(p_vessel_id))) THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||op_id::text,0));
 -- Snapshot the exact reviewed contact/signature, protecting against changes while an offline approval waits.
 IF v->>'status'='APPROVED' THEN LOCK TABLE public.user_signatures,public.captain_sea_mile_contacts IN SHARE MODE; END IF;
 SELECT to_jsonb(r) INTO old FROM public.sea_mile_entries r WHERE id=row_id;
 SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=op_id;
 IF FOUND THEN
 IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>f THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
 IF old IS NULL THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 ELSE
 SELECT to_jsonb(r) INTO old FROM public.sea_mile_entries r WHERE id=row_id FOR UPDATE;
 IF p_operation->>'kind'='create' THEN
 IF f<>'seaMiles' OR v->>'status' NOT IN('DRAFT','PENDING') THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 IF old IS NOT NULL OR p_operation->>'baseRevision' IS NOT NULL THEN RETURN jsonb_build_object('status','conflict'); END IF;
 ELSE
 IF old IS NULL OR old->>'user_id' IS DISTINCT FROM v->>'user_id' THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 IF md5(old::text) IS DISTINCT FROM p_operation->>'baseRevision' THEN RETURN jsonb_build_object('status','conflict'); END IF;
 IF old->>'status'='PENDING' THEN
 IF NOT public.current_user_is_captain_of(p_vessel_id) OR old->>'review_vessel_id' IS DISTINCT FROM p_vessel_id::text OR v->>'status' NOT IN('PENDING','APPROVED','DECLINED') THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 ELSE
 IF f<>'seaMiles' OR old->>'status' NOT IN('DRAFT','DECLINED') OR v->>'status' NOT IN('DRAFT','PENDING') THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 END IF;
 END IF;
 IF v->>'status'='APPROVED' THEN
 IF NOT EXISTS(SELECT 1 FROM public.user_signatures WHERE user_id=auth.uid()) OR NOT EXISTS(SELECT 1 FROM public.captain_sea_mile_contacts WHERE user_id=auth.uid()) THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 IF public.web_offline_sea_review_revision() IS DISTINCT FROM v->>'review_context_revision' THEN RETURN jsonb_build_object('status','conflict'); END IF;
 END IF;
 BEGIN
 IF p_operation->>'kind'='create' THEN
 INSERT INTO public.sea_mile_entries(id,user_id,status,voyage_date,vessel_name,vessel_length,from_location,to_location,capacity_role,miles_logged,day_hours,night_hours,tidal) VALUES(row_id,auth.uid(),'DRAFT',(v->>'voyage_date')::date,(v->>'vessel_name'),(v->>'vessel_length'),(v->>'from_location'),(v->>'to_location'),(v->>'capacity_role'),(v->>'miles_logged')::numeric,(v->>'day_hours')::numeric,(v->>'night_hours')::numeric,(v->>'tidal')::boolean);
 IF v->>'status'='PENDING' THEN UPDATE public.sea_mile_entries SET status='PENDING' WHERE id=row_id;IF NOT FOUND THEN RAISE insufficient_privilege; END IF;END IF;
 ELSE
 UPDATE public.sea_mile_entries SET voyage_date=(v->>'voyage_date')::date,vessel_name=(v->>'vessel_name'),vessel_length=(v->>'vessel_length'),from_location=(v->>'from_location'),to_location=(v->>'to_location'),capacity_role=(v->>'capacity_role'),miles_logged=(v->>'miles_logged')::numeric,day_hours=(v->>'day_hours')::numeric,night_hours=(v->>'night_hours')::numeric,tidal=(v->>'tidal')::boolean,status=v->>'status',decline_comment=v->>'decline_comment' WHERE id=row_id;IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
 END IF;
 INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash) VALUES(auth.uid(),op_id,p_vessel_id,p_device_id,f,row_id,md5(p_operation::text));
 EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('status','forbidden');
 WHEN unique_violation OR serialization_failure OR check_violation OR raise_exception THEN RETURN jsonb_build_object('status','conflict'); END;
 SELECT to_jsonb(r) INTO old FROM public.sea_mile_entries r WHERE id=row_id;
 END IF;
 RETURN jsonb_build_object('status','applied','operationId',op_id,'recordId',row_id,'value',old||jsonb_build_object('review_context_revision',NULL),'revision',md5(old::text));
 END; $$;
 GRANT CREATE ON SCHEMA public TO nautical_offline_writer;
 ALTER FUNCTION public.sync_web_offline_sea_miles(uuid,text,jsonb) OWNER TO nautical_offline_writer;
 REVOKE CREATE ON SCHEMA public FROM nautical_offline_writer;
 REVOKE ALL ON FUNCTION public.sync_web_offline_sea_miles(uuid,text,jsonb) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.sync_web_offline_sea_miles(uuid,text,jsonb) TO authenticated;
 NOTIFY pgrst,'reload schema';
 COMMIT;
