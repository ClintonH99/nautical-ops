export function installDocuments(sql, migration) {
  sql(
    "ALTER TABLE vessels ADD COLUMN IF NOT EXISTS name text DEFAULT 'Offline test vessel'; ALTER TABLE vessels ADD COLUMN IF NOT EXISTS imo_number text DEFAULT 'IMO1234567';",
  );
  sql(migration("20261110180000_web_offline_documents.sql"));
}
