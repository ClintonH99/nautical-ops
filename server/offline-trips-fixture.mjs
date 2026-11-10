export function installTrips(sql, baseline, migration) {
  sql(baseline.match(/CREATE TABLE IF NOT EXISTS "public"\."trips" \([\s\S]*?\n\);/)[0]);
  sql(`ALTER TABLE trips ADD PRIMARY KEY(id); ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT,UPDATE,DELETE ON trips TO authenticated;`);
  sql(baseline.match(/CREATE POLICY "Active vessel members can manage trips"[^;]*;/)[0]);
  sql(migration('20261110060000_web_offline_trips.sql'));
}
