BEGIN;
-- These are the same RLS-visible profiles/signatures used by online exports.
-- Never expose signatures through the app-shell cache or a SECURITY DEFINER bypass.
CREATE FUNCTION public.read_web_offline_document_context(p_vessel_id uuid,p_device_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM public.get_web_offline_context(p_vessel_id,p_device_id);
 RETURN jsonb_build_object('vessel_id',p_vessel_id,
 'vessel',(SELECT jsonb_build_object('id',v.id,'name',v.name,'imo_number',v.imo_number,'created_at',v.created_at) FROM public.vessels v WHERE v.id=p_vessel_id),
 'profiles',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'position',u.position,'vessel_id',u.vessel_id)) FROM public.users u WHERE u.vessel_id=p_vessel_id),'[]'),
 'signatures',COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id',s.user_id,'signature_type',s.signature_type,'signature_image',s.signature_image,'typed_name',s.typed_name)) FROM public.user_signatures s WHERE s.user_id=auth.uid() OR EXISTS(SELECT 1 FROM public.users u WHERE u.id=s.user_id AND u.vessel_id=p_vessel_id)),'[]'));
END; $$;
REVOKE ALL ON FUNCTION public.read_web_offline_document_context(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_web_offline_document_context(uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
