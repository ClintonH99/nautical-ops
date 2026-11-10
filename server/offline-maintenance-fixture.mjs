export function installMaintenance(sql, baseline, migration) {
  sql(
    baseline.match(
      /CREATE TABLE IF NOT EXISTS "public"\."maintenance_logs" \([\s\S]*?\n\);/,
    )[0],
  );
  sql(`ALTER TABLE maintenance_logs ADD PRIMARY KEY(id); ALTER TABLE maintenance_logs ENABLE ROW LEVEL SECURITY;
   GRANT SELECT,INSERT,UPDATE,DELETE ON maintenance_logs TO authenticated;`);
  sql(
    baseline.match(
      /CREATE POLICY "Active vessel members can manage maintenance_logs"[^;]*;/,
    )[0],
  );
  // Only count notification enqueue attempts locally. No delivery, network, tokens or recipients.
  sql(`CREATE TABLE synthetic_notification_capture(source_table text,source_id uuid,event text);
 CREATE FUNCTION public.enqueue_notification(p_table text,p_record jsonb,p_event text,p_key text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.synthetic_notification_capture VALUES(p_table,(p_record->>'id')::uuid,p_event) $$;`);
  const capture = migration("20261001120000_RELIABLE_NOTIFICATION_QUEUE.sql");
  const start = capture.indexOf(
    "CREATE FUNCTION public.capture_operational_notification()",
  );
  sql(
    capture.slice(
      start,
      capture.indexOf("-- There are intentionally no DELETE", start),
    ),
  );
  sql(
    `CREATE TRIGGER capture_notification AFTER INSERT OR UPDATE ON maintenance_logs FOR EACH ROW EXECUTE FUNCTION public.capture_operational_notification();`,
  );
  sql(migration("20261110080000_web_offline_maintenance.sql"));
}
