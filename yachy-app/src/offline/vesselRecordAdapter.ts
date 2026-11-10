import type { OfflineAdapter, RecordValue } from './outbox';
import { validTripDate } from './tripsAdapter.ts';
export type VesselRecordFeature = 'pumpOutLogs' | 'generalWasteLogs' | 'uniforms';
const fields = {
  pumpOutLogs: [
    'id',
    'vessel_id',
    'discharge_type',
    'pumpout_service_name',
    'location',
    'amount_in_gallons',
    'description',
    'log_date',
    'log_time',
    'created_by_name',
    'created_at',
  ],
  generalWasteLogs: [
    'id',
    'vessel_id',
    'log_date',
    'log_time',
    'position_location',
    'description_of_garbage',
    'weight',
    'weight_unit',
    'created_by_name',
    'created_at',
  ],
  uniforms: [
    'id',
    'vessel_id',
    'label',
    'department',
    'entries',
    'created_by',
    'created_at',
    'updated_at',
  ],
};
const nullable = {
  pumpOutLogs: ['pumpout_service_name', 'location', 'description', 'created_by_name'],
  generalWasteLogs: ['position_location', 'description_of_garbage', 'created_by_name'],
  uniforms: ['created_by'],
};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const departments = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];
export const vesselRecordAdapter = (feature: VesselRecordFeature): OfflineAdapter => ({
  serverFields: ['created_at', 'updated_at'],
  validate(v) {
    if (
      !fields[feature].every((k) => k in v) ||
      !Object.keys(v).every((k) => fields[feature].includes(k)) ||
      !['id', 'vessel_id', 'created_at'].every((k) => typeof v[k] === 'string') ||
      !nullable[feature].every((k) => v[k] === null || typeof v[k] === 'string')
    )
      return false;
    if (feature === 'uniforms')
      return (
        typeof v.label === 'string' &&
        !!v.label.trim() &&
        (v.department === null || departments.includes(String(v.department))) &&
        typeof v.updated_at === 'string' &&
        Array.isArray(v.entries) &&
        v.entries.every(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            Object.keys(entry).every((k) =>
              ['amount', 'size', 'color', 'gender', 'dayNight'].includes(k)
            ) &&
            ['amount', 'size', 'color', 'gender'].every((k) => typeof entry[k] === 'string') &&
            (entry.dayNight === undefined || typeof entry.dayNight === 'string')
        )
      );
    if (
      !validTripDate(v.log_date) ||
      typeof v.log_time !== 'string' ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.log_time)
    )
      return false;
    if (feature === 'pumpOutLogs')
      return (
        ['DIRECT_DISCHARGE', 'TREATMENT_PLANT', 'PUMPOUT_SERVICE'].includes(
          String(v.discharge_type)
        ) &&
        finite(v.amount_in_gallons) &&
        v.amount_in_gallons >= 0 &&
        v.amount_in_gallons < 100000000
      );
    return (
      (v.weight === null || (finite(v.weight) && v.weight >= 0)) &&
      (v.weight_unit === null || ['kgs', 'lbs'].includes(String(v.weight_unit)))
    );
  },
  authorizeRead: (scope, v) => scope.vesselId === v.vessel_id,
  authorize: (scope, kind, v, previous) =>
    scope.vesselId === v.vessel_id &&
    (kind === 'create'
      ? feature !== 'uniforms' || v.created_by === scope.userId
      : !!previous &&
        ['id', 'vessel_id', feature === 'uniforms' ? 'created_by' : 'created_by_name'].every(
          (k) => v[k] === previous.value[k]
        )),
});
export function vesselRecordDeviceCopy(
  feature: VesselRecordFeature,
  v: RecordValue,
  id: string,
  userId: string,
  name: string
): RecordValue {
  const label =
    feature === 'uniforms'
      ? 'label'
      : feature === 'pumpOutLogs'
        ? 'description'
        : 'description_of_garbage';
  return {
    ...v,
    id,
    [label]: String(v[label] ?? '') + ' (device copy)',
    created_at: new Date().toISOString(),
    ...(feature === 'uniforms'
      ? { created_by: userId, updated_at: new Date().toISOString() }
      : { created_by_name: name }),
  };
}
