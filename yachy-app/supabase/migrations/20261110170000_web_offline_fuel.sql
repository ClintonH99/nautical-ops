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
    'permissions',jsonb_build_object('fuelLogs',CASE WHEN public.current_user_can_manage_vessel(p_vessel_id) THEN jsonb_build_array('read','create','update') ELSE jsonb_build_array('read','create') END,
      'fuelTransfers',CASE WHEN public.current_user_can_manage_vessel(p_vessel_id) THEN jsonb_build_array('read','create','update') ELSE jsonb_build_array('read','create') END,
      'fuelEntries',CASE WHEN public.current_user_can_manage_vessel(p_vessel_id) THEN jsonb_build_array('read','create','update') ELSE jsonb_build_array('read','create') END,
      'fuelAdjustments',CASE WHEN public.current_user_can_manage_vessel(p_vessel_id) THEN jsonb_build_array('read','create','update') ELSE '[]'::jsonb END,
      'notes',jsonb_build_array('read','create','update'),
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

-- Stable device IDs never replace IDs in the audited fuel ledger.
CREATE TABLE offline_private.fuel_aliases (
 feature text NOT NULL CHECK(feature IN ('fuelLogs','fuelTransfers','fuelEntries')),
 vessel_id uuid NOT NULL REFERENCES public.vessels(id), record_id uuid NOT NULL, source_id uuid NOT NULL,
 PRIMARY KEY(feature,record_id), UNIQUE(feature,source_id)
);
ALTER TABLE offline_private.fuel_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offline_private.fuel_aliases FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON offline_private.fuel_aliases TO nautical_offline_writer;
CREATE POLICY fuel_writer ON offline_private.fuel_aliases TO nautical_offline_writer USING(true) WITH CHECK(true);
CREATE FUNCTION offline_private.fuel_value(vid uuid,f text,rid uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE sid uuid; raw jsonb; fields jsonb; entries jsonb:='[]'; stable_id uuid;
BEGIN
 SELECT source_id INTO sid FROM offline_private.fuel_aliases WHERE feature=f AND record_id=rid AND vessel_id=vid;
 sid:=COALESCE(sid,rid);
 IF f='fuelLogs' THEN
 SELECT to_jsonb(r) INTO raw FROM public.fuel_logs r WHERE id=sid AND vessel_id=vid;
 SELECT jsonb_object_agg(k,raw->k) INTO fields FROM unnest(ARRAY['location_of_refueling','log_date','log_time','amount_of_fuel','price_per_gallon','total_price','volume_unit','price_volume_unit','currency_code','comment','effective_at','utc_offset_minutes']) k;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('fuel_tank_id',e.fuel_tank_id,'amount_litres',e.amount_litres) ORDER BY e.fuel_tank_id),'[]') INTO entries FROM public.fuel_log_tank_entries e WHERE fuel_log_id=sid AND vessel_id=vid;
 ELSIF f='fuelTransfers' THEN
 SELECT to_jsonb(r) INTO raw FROM public.fuel_transfers r WHERE id=sid AND vessel_id=vid;
 IF raw IS NOT NULL THEN raw:=COALESCE((SELECT e FROM jsonb_array_elements(public.get_fuel_transfers_with_snapshots(vid)->'transfers') e WHERE e->>'id'=sid::text),raw); END IF;
 SELECT jsonb_object_agg(k,raw->k) INTO fields FROM unnest(ARRAY['source_tank_id','destination_tank_id','amount_litres','transfer_date','transfer_time','location','notes','effective_at','utc_offset_minutes']) k;
 ELSIF f='fuelEntries' THEN
 SELECT public.get_fuel_inventory_operation(r.id) INTO raw FROM public.fuel_inventory_operations r WHERE id=sid AND vessel_id=vid AND operation_type IN('SOUNDING','CONSUMPTION','ADJUSTMENT');
 fields:=jsonb_build_object('operation_type',raw->'operation_type','effective_at',raw->'effective_at','utc_offset_minutes',raw->'utc_offset_minutes','fuel_tank_id',raw#>'{postings,0,fuel_tank_id}','amount_litres',CASE WHEN raw->>'operation_type'='CONSUMPTION' THEN -(raw#>>'{postings,0,amount_litres}')::numeric ELSE (raw#>>'{postings,0,amount_litres}')::numeric END,'location',COALESCE(raw#>>'{metadata,location}',''),'reason',COALESCE(raw#>>'{metadata,reason}',''),'notes',COALESCE(raw#>>'{metadata,notes}',''));
 ELSE RAISE EXCEPTION 'Unsupported fuel feature' USING ERRCODE='22023'; END IF;
 IF raw IS NULL THEN RETURN NULL; END IF;
 SELECT record_id INTO stable_id FROM offline_private.fuel_aliases WHERE feature=f AND source_id=sid AND vessel_id=vid;
 RETURN jsonb_build_object('id',COALESCE(stable_id,sid),'vessel_id',vid,'source_id',sid,'fields',fields,'entries',entries,'server',raw,'amendment_reason','');
END; $$;
REVOKE ALL ON FUNCTION offline_private.fuel_value(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION offline_private.fuel_value(uuid,text,uuid) TO nautical_offline_writer;
CREATE FUNCTION public.read_web_offline_fuel(p_vessel_id uuid,p_device_id text,p_feature text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 IF p_feature NOT IN('fuelLogs','fuelTransfers','fuelEntries') THEN RAISE EXCEPTION 'Unsupported feature' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('value',v,'revision',md5(v::text))),'[]') INTO result FROM (
 SELECT offline_private.fuel_value(p_vessel_id,p_feature,id) v FROM (
 SELECT id FROM public.fuel_logs WHERE p_feature='fuelLogs' AND vessel_id=p_vessel_id AND voided_at IS NULL
 UNION ALL SELECT id FROM public.fuel_transfers WHERE p_feature='fuelTransfers' AND vessel_id=p_vessel_id AND voided_at IS NULL
 UNION ALL SELECT r.id FROM public.fuel_inventory_operations r WHERE p_feature='fuelEntries' AND vessel_id=p_vessel_id AND operation_type IN('SOUNDING','CONSUMPTION','ADJUSTMENT') AND NOT EXISTS(SELECT 1 FROM public.fuel_inventory_voids x WHERE x.operation_id=r.id)
 ) ids) values WHERE v IS NOT NULL;
 RETURN result;
END; $$;
CREATE FUNCTION public.read_web_offline_fuel_context(p_vessel_id uuid,p_device_id text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE audits jsonb:='[]'; page jsonb; cursor_at timestamptz; cursor_id uuid;
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 LOOP
 page:=public.get_fuel_inventory_legacy_audits(p_vessel_id,NULL,NULL,100,cursor_at,cursor_id);
 audits:=audits||(page->'audits');
 EXIT WHEN page->>'next_cursor' IS NULL;
 cursor_at:=(page#>>'{next_cursor,recorded_at}')::timestamptz;cursor_id:=(page#>>'{next_cursor,id}')::uuid;
 END LOOP;
 RETURN jsonb_build_object('legacy_audits',audits,'vessel_id',p_vessel_id,'downloaded_at',now(),'setup',public.get_vessel_fuel_setup(p_vessel_id),
 'tanks',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.fuel_tanks t WHERE vessel_id=p_vessel_id),'[]'),
 'operations',COALESCE((SELECT jsonb_agg(public.get_fuel_inventory_operation(r.id) ORDER BY recorded_sequence DESC) FROM public.fuel_inventory_operations r WHERE vessel_id=p_vessel_id),'[]'),
 'allocations',public.get_fuel_log_allocation_snapshot(p_vessel_id,ARRAY(SELECT id FROM public.fuel_logs WHERE vessel_id=p_vessel_id))->'allocations',
 'snapshot',public.get_fuel_inventory_snapshot(p_vessel_id,now()));
END; $$;
CREATE FUNCTION public.sync_web_offline_fuel(p_vessel_id uuid,p_device_id text,p_operation jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f text:=p_operation->>'feature'; kind text:=p_operation->>'kind'; v jsonb:=p_operation->'value';
 oid uuid; rid uuid; sid uuid; old jsonb; result jsonb; fields jsonb; allowed text[];
 receipt offline_private.record_receipts%ROWTYPE;
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 IF jsonb_typeof(p_operation)<>'object' OR octet_length(p_operation::text)>260000 OR f IS NULL OR f NOT IN('fuelLogs','fuelTransfers','fuelEntries') OR kind IS NULL OR kind NOT IN('create','update') OR jsonb_typeof(v)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_operation) k WHERE k NOT IN('id','feature','recordId','kind','value','baseRevision')) THEN RAISE EXCEPTION 'Invalid fuel operation' USING ERRCODE='22023'; END IF;
 oid:=(p_operation->>'id')::uuid;rid:=(p_operation->>'recordId')::uuid; fields:=v->'fields';
 allowed:=CASE f WHEN 'fuelLogs' THEN ARRAY['location_of_refueling','log_date','log_time','amount_of_fuel','price_per_gallon','total_price','volume_unit','price_volume_unit','currency_code','comment','effective_at','utc_offset_minutes'] WHEN 'fuelTransfers' THEN ARRAY['source_tank_id','destination_tank_id','amount_litres','transfer_date','transfer_time','location','notes','effective_at','utc_offset_minutes'] ELSE ARRAY['operation_type','effective_at','utc_offset_minutes','fuel_tank_id','amount_litres','location','reason','notes'] END;
 IF oid IS NULL OR rid IS NULL OR (v->>'id')::uuid IS DISTINCT FROM rid OR (v->>'vessel_id')::uuid IS DISTINCT FROM p_vessel_id OR jsonb_typeof(fields) IS DISTINCT FROM 'object' OR jsonb_typeof(v->'entries') IS DISTINCT FROM 'array' OR jsonb_typeof(v->'server') IS DISTINCT FROM 'object' OR jsonb_typeof(v->'amendment_reason') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid fuel value' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN('id','vessel_id','source_id','fields','entries','server','amendment_reason')) OR EXISTS(SELECT 1 FROM jsonb_object_keys(fields) k WHERE NOT k=ANY(allowed)) OR NOT fields ?& allowed OR (f<>'fuelLogs' AND v->'entries'<>'[]'::jsonb) THEN RAISE EXCEPTION 'Unexpected fields' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'entries') e WHERE jsonb_typeof(e)<>'object') THEN RAISE EXCEPTION 'Invalid allocation' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'entries') e CROSS JOIN LATERAL jsonb_object_keys(e) k WHERE k NOT IN('fuel_tank_id','amount_litres')) THEN RAISE EXCEPTION 'Invalid allocation fields' USING ERRCODE='22023'; END IF;
 IF (kind='update' OR (f='fuelEntries' AND fields->>'operation_type'='ADJUSTMENT')) AND NOT public.current_user_can_manage_vessel(p_vessel_id) THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||oid::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_vessel_id::text||f||rid::text,0));
 old:=offline_private.fuel_value(p_vessel_id,f,rid);
 SELECT * INTO receipt FROM offline_private.record_receipts WHERE user_id=auth.uid() AND operation_id=oid;
 IF FOUND THEN
 IF receipt.request_hash<>md5(p_operation::text) OR receipt.device_id<>p_device_id OR receipt.vessel_id<>p_vessel_id OR receipt.feature<>f THEN RAISE EXCEPTION 'Operation ID reused' USING ERRCODE='22023'; END IF;
 IF old IS NULL THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 ELSE
 IF kind='create' THEN
 IF old IS NOT NULL OR p_operation->>'baseRevision' IS NOT NULL OR v->>'source_id' IS NOT NULL THEN RETURN jsonb_build_object('status','conflict'); END IF;
 ELSE
 IF old IS NULL THEN RETURN jsonb_build_object('status','forbidden'); END IF;
 IF old->>'source_id' IS DISTINCT FROM v->>'source_id' OR md5(old::text) IS DISTINCT FROM p_operation->>'baseRevision' OR old#>>'{server,voided_at}' IS NOT NULL OR old#>>'{server,void_kind}' IS NOT NULL THEN RETURN jsonb_build_object('status','conflict'); END IF;
 END IF;
 BEGIN
 sid:=(old->>'source_id')::uuid;
 IF f='fuelLogs' THEN
 IF kind='create' THEN
 result:=to_jsonb(public.create_fuel_receipt_with_tanks(fields||jsonb_build_object('vessel_id',p_vessel_id,'client_request_id',oid),v->'entries','[]'::jsonb,NULL));
 ELSE
 IF fields->>'effective_at' IS NULL AND old#>>'{fields,effective_at}' IS NULL THEN fields:=fields-ARRAY['effective_at','utc_offset_minutes','log_date','log_time']; END IF;
 result:=to_jsonb(public.update_fuel_log_with_tank_entries(sid,p_vessel_id,fields||jsonb_build_object('client_request_id',oid,'expected_revision',old#>'{server,inventory_revision}','amendment_reason',v->>'amendment_reason'),v->'entries'));
 END IF; sid:=(result->>'id')::uuid;
 ELSIF f='fuelTransfers' THEN
 IF kind='create' THEN result:=public.record_fuel_transfer(fields||jsonb_build_object('vessel_id',p_vessel_id),oid);
 ELSE result:=public.amend_fuel_transfer(sid,(old#>>'{server,inventory_revision}')::integer,fields||jsonb_build_object('vessel_id',p_vessel_id),v->>'amendment_reason',oid); END IF;
 sid:=COALESCE(result#>>'{transfer,id}',result->>'id')::uuid;
 ELSE
 IF kind='create' THEN result:=public.record_fuel_inventory_entry(p_vessel_id,fields->>'operation_type',(fields->>'effective_at')::timestamptz,(fields->>'utc_offset_minutes')::smallint,(fields->>'fuel_tank_id')::uuid,(fields->>'amount_litres')::numeric,fields->>'location',fields->>'reason',fields->>'notes',oid);
 ELSE
 IF fields->>'operation_type' IS DISTINCT FROM old#>>'{fields,operation_type}' OR fields->>'fuel_tank_id' IS DISTINCT FROM old#>>'{fields,fuel_tank_id}' THEN RAISE insufficient_privilege; END IF;
 result:=public.amend_fuel_inventory_entry(sid,(old#>>'{server,revision_no}')::integer,(fields->>'effective_at')::timestamptz,(fields->>'utc_offset_minutes')::smallint,(fields->>'amount_litres')::numeric,fields->>'location',fields->>'reason',fields->>'notes',v->>'amendment_reason',oid);
 END IF; sid:=(result->>'id')::uuid;
 END IF;
 IF sid IS NULL THEN RAISE EXCEPTION 'Missing fuel result'; END IF;
 INSERT INTO offline_private.fuel_aliases(feature,vessel_id,record_id,source_id) VALUES(f,p_vessel_id,rid,sid) ON CONFLICT(feature,record_id) DO UPDATE SET source_id=EXCLUDED.source_id WHERE fuel_aliases.vessel_id=EXCLUDED.vessel_id;
 INSERT INTO offline_private.record_receipts(user_id,operation_id,vessel_id,device_id,feature,record_id,request_hash) VALUES(auth.uid(),oid,p_vessel_id,p_device_id,f,rid,md5(p_operation::text));
 EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('status','forbidden');
 WHEN unique_violation OR serialization_failure OR check_violation OR raise_exception THEN RETURN jsonb_build_object('status','conflict'); END;
 old:=offline_private.fuel_value(p_vessel_id,f,rid);
 END IF;
 RETURN jsonb_build_object('status','applied','operationId',oid,'recordId',rid,'value',old,'revision',md5(old::text));
END; $$;
GRANT CREATE ON SCHEMA public TO nautical_offline_writer;
ALTER FUNCTION public.read_web_offline_fuel(uuid,text,text) OWNER TO nautical_offline_writer;
ALTER FUNCTION public.sync_web_offline_fuel(uuid,text,jsonb) OWNER TO nautical_offline_writer;
REVOKE CREATE ON SCHEMA public FROM nautical_offline_writer;
REVOKE ALL ON FUNCTION public.read_web_offline_fuel(uuid,text,text),public.sync_web_offline_fuel(uuid,text,jsonb),public.read_web_offline_fuel_context(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_fuel(uuid,text,text),public.sync_web_offline_fuel(uuid,text,jsonb),public.read_web_offline_fuel_context(uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
