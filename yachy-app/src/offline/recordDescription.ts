import type { Json, RecordValue } from './outbox';
/** Human-readable saved values. Internal IDs and embedded signature images are omitted. */
export function describeOfflineRecord(value: RecordValue): string {
  const hidden =
    /(^id$|_id$|_ids$|^created_at$|^updated_at$|revision|signature_image|watch_versions|^owner_name$)/;
  const label = (key: string) => key.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  function format(v: Json, depth: number): string {
    if (v === null) return 'Not set';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v !== 'object') return String(v);
    if (depth > 4) return 'Additional details saved';
    if (Array.isArray(v))
      return v.map((item, i) => `${i + 1}. ${format(item, depth + 1)}`).join('\n');
    return Object.entries(v)
      .filter(([k]) => !hidden.test(k))
      .map(([k, item]) => `${label(k)}: ${format(item, depth + 1)}`)
      .join('\n');
  }
  return format(value, 0);
}
