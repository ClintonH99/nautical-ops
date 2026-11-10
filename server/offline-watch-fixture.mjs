export function installWatch(sql, baseline, migration) {
  sql(`CREATE TABLE IF NOT EXISTS vessels(id uuid PRIMARY KEY,is_solo boolean DEFAULT false);
 ALTER TABLE vessels ADD COLUMN IF NOT EXISTS is_solo boolean DEFAULT false;
 INSERT INTO vessels(id) SELECT DISTINCT vessel_id FROM users WHERE vessel_id IS NOT NULL ON CONFLICT DO NOTHING;
 GRANT SELECT ON vessels TO authenticated;`);
  for (const table of [
    "watch_keeping_rules",
    "watch_keeping_timetables",
    "rest_entries",
  ]) {
    const definition = baseline.match(
      new RegExp(
        'CREATE TABLE IF NOT EXISTS "public"\\."' +
          table +
          '" \\([\\s\\S]*?\\n\\);',
      ),
    )?.[0];
    if (!definition) throw Error("Missing shipped watch/rest schema");
    sql(definition);
    sql(
      `ALTER TABLE ${table} ADD PRIMARY KEY(id); ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO authenticated;`,
    );
    if (table !== "rest_entries") {
      const policies = baseline.match(
        new RegExp(
          'CREATE POLICY [^;]+ ON "public"\\."' + table + '"[^;]*;',
          "g",
        ),
      );
      if (!policies?.length) throw Error("Missing shipped watch policies");
      for (const p of policies) sql(p);
    }
  }
  sql("ALTER TABLE watch_keeping_rules ADD UNIQUE(vessel_id);");
  sql(migration("20260927130000_PERSONAL_WATCH_SCHEDULE_CREATE.sql"));
  sql(migration("20260930100000_ATOMIC_WATCH_PUBLICATION.sql"));
  sql(
    "CREATE TRIGGER capture_notification AFTER INSERT OR UPDATE ON watch_keeping_timetables FOR EACH ROW EXECUTE FUNCTION public.capture_operational_notification();",
  );
  sql(migration("20261110130000_web_offline_watch_keeping.sql"));
}
