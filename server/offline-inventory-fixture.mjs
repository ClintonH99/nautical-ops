export function installInventory(sql, baseline, migration) {
  for (const table of ["inventory_items"]) {
    const tableSql = baseline.match(
      new RegExp(
        'CREATE TABLE IF NOT EXISTS "public"\\."' +
          table +
          '" \\([\\s\\S]*?\\n\\);',
      ),
    )?.[0];
    const policySql = baseline.match(
      new RegExp(
        'CREATE POLICY "Active vessel members can manage ' + table + '"[^;]*;',
      ),
    )?.[0];
    if (!tableSql || !policySql)
      throw new Error("Missing shipped schema or policy");
    sql(tableSql);
    sql(`ALTER TABLE ${table} ADD PRIMARY KEY(id); ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO authenticated;`);
    sql(policySql);
  }
  sql(migration("20261110100000_web_offline_inventory.sql"));
}
