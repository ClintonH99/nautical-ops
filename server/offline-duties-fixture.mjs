export function installDuties(sql,baseline,migration){
 for(const table of ['watch_duty_rules','watch_duty_groups','watch_duty_items','watch_duty_completions','watch_assignments']){
  const schema=baseline.match(new RegExp('CREATE TABLE IF NOT EXISTS "public"\\."'+table+'" \\([\\s\\S]*?\\n\\);'))?.[0];
  if(!schema)throw Error('Missing shipped duty schema');sql(schema);
  const pk=table==='watch_duty_rules'?'vessel_id':table==='watch_duty_completions'?'user_id,item_id':'id';
  sql(`ALTER TABLE ${table} ADD PRIMARY KEY(${pk});ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO authenticated;`);
  const policies=baseline.match(new RegExp('CREATE POLICY [^;]+ ON "public"\\."'+table+'"[^;]*;','g'));
  if(!policies?.length)throw Error('Missing duty policies');for(const p of policies)sql(p);
 }
 sql(`ALTER TABLE watch_duty_items ADD FOREIGN KEY(group_id) REFERENCES watch_duty_groups(id) ON DELETE CASCADE;
 ALTER TABLE watch_duty_completions ADD FOREIGN KEY(item_id) REFERENCES watch_duty_items(id) ON DELETE CASCADE;
 ALTER TABLE watch_duty_completions ADD FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE;
 ALTER TABLE watch_assignments ADD FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE;`);
 sql(migration('20261110150000_web_offline_watch_duties.sql'));
}
