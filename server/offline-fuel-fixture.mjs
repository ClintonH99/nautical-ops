export function installFuel(sql, baseline, migration) {
  const table = baseline.match(
    /CREATE TABLE IF NOT EXISTS "public"\."fuel_logs" \([\s\S]*?\n\);/,
  )[0];
  sql(table);
  sql(`ALTER TABLE fuel_logs ADD PRIMARY KEY(id); ALTER TABLE fuel_logs ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT,UPDATE,DELETE ON fuel_logs TO authenticated;
 CREATE POLICY fuel_member ON fuel_logs TO authenticated USING(public.current_user_can_access_vessel(vessel_id)) WITH CHECK(public.current_user_can_access_vessel(vessel_id));`);
  for (const name of [
    "20260918150000_ADD_VESSEL_FUEL_FOUNDATION.sql",
    "20260918160000_ADD_FUEL_INVENTORY_LEDGER.sql",
    "20260921130000_ADD_INLINE_FUEL_RECEIPT_TANKS.sql",
    "20260921170000_MAKE_FUEL_RECEIPTS_STANDALONE.sql",
    "20261110170000_web_offline_fuel.sql",
  ])
    sql(migration(name));
}
