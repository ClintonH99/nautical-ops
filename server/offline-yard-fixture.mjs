// Production yard schema, completion trigger and folder policies in an isolated database.
export function installYard(sql, baseline, migration) {
  sql(`CREATE TABLE IF NOT EXISTS vessels(id uuid PRIMARY KEY);
    INSERT INTO vessels SELECT DISTINCT vessel_id FROM users WHERE vessel_id IS NOT NULL ON CONFLICT DO NOTHING;
    CREATE OR REPLACE FUNCTION public.current_user_is_captain_of(v uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT public.current_user_can_access_vessel(v) AND EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND vessel_id=v AND role='CAPTAIN_MOV')$$;
    CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=now(); RETURN NEW; END;$$;`);
  sql(
    baseline.match(
      /CREATE TABLE IF NOT EXISTS "public"\."yard_period_jobs" \([\s\S]*?\n\);/,
    )[0],
  );
  sql(`ALTER TABLE yard_period_jobs ADD PRIMARY KEY(id); ALTER TABLE yard_period_jobs ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT,UPDATE,DELETE ON yard_period_jobs TO authenticated;`);
  sql(migration("20260904130000_SHIPYARD_JOB_DATE_RANGES.sql"));
  sql(migration("20260912120000_ADD_SHIPYARD_RECORDS.sql"));
  sql(migration("20260918120000_MAKE_SHIPYARD_FOLDERS_VESSEL_WIDE.sql"));
  sql(migration("20261110070000_web_offline_yard_jobs.sql"));
}
