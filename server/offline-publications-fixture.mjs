// Local-only fixtures use the shipped publication policies, not permissive stand-ins.
export function installPublications(sql, baseline, migration) {
  sql(`ALTER TABLE users ADD COLUMN role text DEFAULT 'CREW';
    GRANT SELECT ON users TO authenticated;
    CREATE OR REPLACE FUNCTION public.current_user_can_manage_vessel(v uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT public.current_user_can_access_vessel(v) AND EXISTS(
        SELECT 1 FROM public.users WHERE id=auth.uid() AND vessel_id=v AND role IN('HOD','CAPTAIN_MOV')) $$;`);
  for (const table of ['rules','safety_equipment','muster_stations']) {
    sql(baseline.match(new RegExp('CREATE TABLE IF NOT EXISTS "public"\\."'+table+'" \\([\\s\\S]*?\\n\\);'))[0]);
    sql(`ALTER TABLE ${table} ADD PRIMARY KEY(id); ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO authenticated;`);
  }
  const policies = migration('20260903152000_SERVER_SIDE_ACCESS_ENFORCEMENT.sql');
  const start = policies.indexOf('-- HOD/Captain-managed tables with a direct vessel_id column.');
  sql(policies.slice(start, policies.indexOf('END\n$$;',start)+7));
  sql(migration('20260927120000_CREW_SAFETY_EQUIPMENT_EDIT.sql'));
  sql(migration('20261110050000_web_offline_publications.sql'));
}
