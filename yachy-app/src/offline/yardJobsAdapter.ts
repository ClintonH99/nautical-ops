import type { OfflineAdapter, RecordValue } from './outbox';
import { requireOfflineAccess } from './access.ts';
import { validTripDate } from './tripsAdapter.ts';
const fields = [
  'id',
  'vessel_id',
  'job_title',
  'job_description',
  'yard_location',
  'contractor_company_name',
  'contact_details',
  'done_by_date',
  'status',
  'completed_by',
  'completed_at',
  'completed_by_name',
  'created_by',
  'created_at',
  'updated_at',
  'department',
  'priority',
  'trip_id',
  'defect_details',
  'defect_location',
  'equipment_serial',
  'start_date',
  'end_date',
];
const nullable = [
  'job_description',
  'yard_location',
  'contractor_company_name',
  'contact_details',
  'done_by_date',
  'completed_by',
  'completed_at',
  'completed_by_name',
  'created_by',
  'trip_id',
  'defect_details',
  'defect_location',
  'equipment_serial',
];
export const yardJobsAdapter: OfflineAdapter = {
  serverFields: ['created_at', 'updated_at'],
  validate: (v) =>
    fields.every((k) => k in v) &&
    Object.keys(v).every((k) => fields.includes(k)) &&
    ['id', 'vessel_id', 'job_title', 'created_at', 'updated_at'].every(
      (k) => typeof v[k] === 'string'
    ) &&
    String(v.job_title).trim().length > 0 &&
    nullable.every((k) => v[k] === null || typeof v[k] === 'string') &&
    ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'].includes(String(v.department)) &&
    ['GREEN', 'YELLOW', 'RED'].includes(String(v.priority)) &&
    ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'].includes(String(v.status)) &&
    ((v.start_date === null && v.end_date === null) ||
      (validTripDate(v.start_date) && validTripDate(v.end_date) && v.end_date >= v.start_date)),
  authorizeRead: (s, v) => s.vesselId === v.vessel_id,
  authorize: (s, kind, v, previous, context) => {
    if (s.vesselId !== v.vessel_id) return false;
    const completionValid =
      v.status === 'COMPLETED'
        ? v.completed_by === s.userId &&
          typeof v.completed_at === 'string' &&
          typeof v.completed_by_name === 'string'
        : v.completed_by === null && v.completed_at === null && v.completed_by_name === null;
    if (kind === 'create') return v.created_by === s.userId && completionValid;
    if (
      !previous ||
      ['id', 'vessel_id', 'created_by', 'trip_id', 'done_by_date'].some(
        (k) => v[k] !== previous.value[k]
      )
    )
      return false;
    if (previous.value.status !== 'COMPLETED') return completionValid;
    if (
      v.status !== 'COMPLETED' ||
      ['completed_by', 'completed_at', 'completed_by_name'].some((k) => v[k] !== previous.value[k])
    )
      return false;
    // Replaying an unchanged completion is allowed. Editing its information requires
    // the server-issued Captain permission, and the database rechecks at upload.
    if (
      fields
        .filter((k) => !['created_at', 'updated_at'].includes(k))
        .every((k) => v[k] === previous.value[k])
    )
      return true;
    try {
      if (!context) return false;
      requireOfflineAccess(context, 'shipyardRecords', 'update');
      return true;
    } catch {
      return false;
    }
  },
};
export function yardJobDeviceCopy(v: RecordValue, id: string, userId: string): RecordValue {
  return {
    ...v,
    id,
    job_title: String(v.job_title) + ' (device copy)',
    created_by: userId,
    done_by_date: null,
    status: 'NOT_STARTED',
    completed_by: null,
    completed_at: null,
    completed_by_name: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
