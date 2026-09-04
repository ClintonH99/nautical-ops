/**
 * Supabase update/delete calls do not error when row-level security or a stale
 * ID causes zero rows to match. Always request the affected IDs with
 * `.select('id')`, then use this guard before reporting success to the UI.
 */
export function requireAffectedRows(data: unknown[] | null, error: unknown, action: string): void {
  if (error) throw error;
  if (!data?.length) {
    throw new Error(`${action} failed because the record was not found or access was denied.`);
  }
}
