export function installChecklists(sql, baseline, migration) {
  for (const table of [
    "pre_departure_checklists",
    "pre_departure_checklist_items",
  ]) {
    const definition = baseline.match(
      new RegExp(
        'CREATE TABLE IF NOT EXISTS "public"\\."' +
          table +
          '" \\([\\s\\S]*?\\n\\);',
      ),
    )?.[0];
    const policies = baseline.match(
      new RegExp(
        'CREATE POLICY [^;]+ ON "public"\\."' + table + '"[^;]*;',
        "g",
      ),
    );
    if (!definition || !policies?.length)
      throw new Error("Missing shipped checklist schema or policy");
    sql(definition);
    sql(`ALTER TABLE ${table} ADD PRIMARY KEY(id); ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO authenticated;`);
    for (const policy of policies) sql(policy);
  }
  sql(
    "ALTER TABLE pre_departure_checklist_items ADD FOREIGN KEY(checklist_id) REFERENCES pre_departure_checklists(id) ON DELETE CASCADE;",
  );
  sql(migration("20261110110000_web_offline_checklists.sql"));
}
