export function installRest(sql, baseline, migration, user) {
  sql("CREATE TABLE IF NOT EXISTS department_signers(id uuid PRIMARY KEY);");
  sql(migration("20261021120000_CAPTAIN_ONLY_REST_REVIEW.sql"));
  for (const policy of baseline.match(
    /CREATE POLICY [^;]+ ON "public"\."rest_entries"[^;]*;/g,
  ) || [])
    sql(policy);
  sql("ALTER TABLE rest_entries ADD UNIQUE(user_id,date);");
  const table = baseline.match(
    /CREATE TABLE IF NOT EXISTS "public"\."user_signatures" \([\s\S]*?\n\);/,
  )?.[0];
  if (!table) throw Error("Missing signature schema");
  sql(table);
  sql(
    "ALTER TABLE user_signatures ADD PRIMARY KEY(id);ALTER TABLE user_signatures ADD UNIQUE(user_id); ALTER TABLE user_signatures ENABLE ROW LEVEL SECURITY;GRANT SELECT,INSERT,UPDATE,DELETE ON user_signatures TO authenticated;",
  );
  for (const policy of baseline.match(
    /CREATE POLICY [^;]+ ON "public"\."user_signatures"[^;]*;/g,
  ) || [])
    sql(policy);
  sql(
    `INSERT INTO user_signatures(user_id,signature_type,typed_name) VALUES('${user}','typed','Synthetic Captain');`,
  );
  sql(migration("20261110140000_web_offline_rest_entries.sql"));
}
