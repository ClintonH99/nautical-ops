import type { OfflineAdapter, RecordValue } from './outbox';
const fields = [
  'id',
  'vessel_id',
  'equipment',
  'serial_number',
  'hours_of_service',
  'hours_at_next_service',
  'what_service_done',
  'notes',
  'service_done_by',
  'created_at',
  'updated_at',
  'port_starboard_na',
];
const nullable = [
  'serial_number',
  'hours_of_service',
  'hours_at_next_service',
  'what_service_done',
  'notes',
  'port_starboard_na',
];
export const maintenanceAdapter: OfflineAdapter = {
  serverFields: ['created_at', 'updated_at'],
  validate: (v) =>
    fields.every((k) => k in v) &&
    Object.keys(v).every((k) => fields.includes(k)) &&
    ['id', 'vessel_id', 'equipment', 'service_done_by', 'created_at', 'updated_at'].every(
      (k) => typeof v[k] === 'string'
    ) &&
    String(v.equipment).trim().length > 0 &&
    String(v.service_done_by).trim().length > 0 &&
    nullable.every((k) => v[k] === null || typeof v[k] === 'string'),
  authorizeRead: (s, v) => s.vesselId === v.vessel_id,
  authorize: (s, kind, v, previous) =>
    s.vesselId === v.vessel_id &&
    (kind === 'create' ||
      (!!previous && ['id', 'vessel_id'].every((k) => v[k] === previous.value[k]))),
};
export function maintenanceDeviceCopy(v: RecordValue, id: string): RecordValue {
  return {
    ...v,
    id,
    equipment: String(v.equipment) + ' (device copy)',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
