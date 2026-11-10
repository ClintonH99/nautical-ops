import type { OfflineAdapter, RecordValue } from './outbox';
const fields = [
  'id',
  'vessel_id',
  'type',
  'title',
  'start_date',
  'end_date',
  'notes',
  'created_by',
  'created_at',
  'updated_at',
  'department',
  'yard_location',
  'contractor_company_name',
  'contact_details',
];
export function validTripDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const tripsAdapter: OfflineAdapter = {
  serverFields: ['created_at', 'updated_at'],
  validate: (v) =>
    fields.every((k) => k in v) &&
    Object.keys(v).every((k) => fields.includes(k)) &&
    ['id', 'vessel_id', 'title', 'created_at', 'updated_at'].every(
      (k) => typeof v[k] === 'string'
    ) &&
    String(v.title).trim().length > 0 &&
    ['notes', 'created_by', 'yard_location', 'contractor_company_name', 'contact_details'].every(
      (k) => v[k] === null || typeof v[k] === 'string'
    ) &&
    ['GUEST', 'BOSS', 'DELIVERY', 'YARD_PERIOD'].includes(String(v.type)) &&
    (v.department === null ||
      ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'].includes(String(v.department))) &&
    validTripDate(v.start_date) &&
    validTripDate(v.end_date) &&
    v.end_date >= v.start_date,
  authorizeRead: (s, v) => s.vesselId === v.vessel_id,
  authorize: (s, kind, v, previous) =>
    s.vesselId === v.vessel_id &&
    (kind === 'create'
      ? v.created_by === s.userId
      : !!previous &&
        ['id', 'vessel_id', 'type', 'created_by'].every((k) => v[k] === previous.value[k])),
};
export function tripDeviceCopy(v: RecordValue, id: string, userId: string): RecordValue {
  return {
    ...v,
    id,
    title: String(v.title) + ' (device copy)',
    created_by: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
