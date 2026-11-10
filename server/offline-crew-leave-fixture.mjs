export function installCrewLeave(sql, migration) {
  sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name text DEFAULT 'Synthetic crew';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS position text DEFAULT 'Captain';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS department text DEFAULT 'BRIDGE';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS department_2 text;`);
  sql(migration("20260910190000_ADD_CREW_LEAVE.sql"));
  sql(migration("20260921120000_PRESERVE_AND_FILTER_CREW_LEAVE_HISTORY.sql"));
  sql(
    "CREATE TRIGGER capture_notification AFTER INSERT OR UPDATE ON crew_leave FOR EACH ROW EXECUTE FUNCTION public.capture_operational_notification();",
  );
  sql(migration("20261110120000_web_offline_crew_leave.sql"));
}
