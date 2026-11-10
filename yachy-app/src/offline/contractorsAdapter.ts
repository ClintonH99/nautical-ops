import type { OfflineAdapter, RecordValue } from './outbox';
const fields = [
  'id',
  'vessel_id',
  'department',
  'company_name',
  'company_address',
  'known_for',
  'description',
  'contacts',
  'created_by',
  'created_at',
];
export const contractorsAdapter: OfflineAdapter = {
  serverFields: ['created_at'],
  validate: (v) =>
    fields.every((k) => k in v) &&
    Object.keys(v).every((k) => fields.includes(k)) &&
    ['id', 'vessel_id', 'company_name', 'created_at'].every((k) => typeof v[k] === 'string') &&
    String(v.company_name).trim().length > 0 &&
    ['company_address', 'known_for', 'description', 'created_by'].every(
      (k) => v[k] === null || typeof v[k] === 'string'
    ) &&
    ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'].includes(String(v.department)) &&
    Array.isArray(v.contacts) &&
    v.contacts.every(
      (c) =>
        !!c &&
        typeof c === 'object' &&
        !Array.isArray(c) &&
        ['name', 'mobile', 'email'].every((k) => typeof c[k] === 'string') &&
        Object.keys(c).every((k) => ['name', 'mobile', 'email'].includes(k))
    ),
  authorizeRead: (s, v) => s.vesselId === v.vessel_id,
  authorize: (s, kind, v, previous) =>
    s.vesselId === v.vessel_id &&
    (kind === 'create'
      ? v.created_by === s.userId
      : !!previous && ['id', 'vessel_id', 'created_by'].every((k) => v[k] === previous.value[k])),
};
export function contractorDeviceCopy(v: RecordValue, id: string, userId: string): RecordValue {
  return {
    ...v,
    id,
    created_by: userId,
    created_at: new Date().toISOString(),
    company_name: String(v.company_name) + ' (device copy)',
  };
}
