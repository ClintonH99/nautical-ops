import type { OfflineAdapter, RecordValue } from './outbox';
import { validTripDate } from './tripsAdapter.ts';
const departments = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];
const fields = [
  'id',
  'vessel_id',
  'crew_member_id',
  'leave_type',
  'start_date',
  'end_date',
  'notes',
  'created_by',
  'created_at',
  'updated_at',
  'crew_member_name_snapshot',
  'crew_member_position_snapshot',
  'crew_member_departments_snapshot',
];
export const crewLeaveAdapter: OfflineAdapter = {
  serverFields: [
    'created_at',
    'updated_at',
    'crew_member_name_snapshot',
    'crew_member_position_snapshot',
    'crew_member_departments_snapshot',
  ],
  validate: (v) =>
    fields.every((k) => k in v) &&
    Object.keys(v).every((k) => fields.includes(k)) &&
    [
      'id',
      'vessel_id',
      'notes',
      'created_at',
      'updated_at',
      'crew_member_name_snapshot',
      'crew_member_position_snapshot',
    ].every((k) => typeof v[k] === 'string') &&
    ['crew_member_id', 'created_by'].every((k) => v[k] === null || typeof v[k] === 'string') &&
    String(v.notes).length <= 1000 &&
    ['ANNUAL', 'SICK', 'ROTATION', 'OTHER'].includes(String(v.leave_type)) &&
    validTripDate(v.start_date) &&
    validTripDate(v.end_date) &&
    v.end_date >= v.start_date &&
    Array.isArray(v.crew_member_departments_snapshot) &&
    v.crew_member_departments_snapshot.length >= 1 &&
    v.crew_member_departments_snapshot.length <= 2 &&
    new Set(v.crew_member_departments_snapshot).size ===
      v.crew_member_departments_snapshot.length &&
    v.crew_member_departments_snapshot.every((d) => departments.includes(String(d))),
  authorizeRead: (s, v) => v.vessel_id === s.vesselId,
  authorize: (s, kind, v, previous) =>
    v.vessel_id === s.vesselId &&
    (kind === 'create'
      ? v.created_by === s.userId && typeof v.crew_member_id === 'string'
      : !!previous && ['id', 'vessel_id', 'created_by'].every((k) => v[k] === previous.value[k])),
};
export function crewLeaveDeviceCopy(v: RecordValue, id: string, userId: string): RecordValue {
  return {
    ...v,
    id,
    created_by: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
