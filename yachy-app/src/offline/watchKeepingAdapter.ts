import type { OfflineAdapter, RecordValue } from './outbox';
import { validTripDate } from './tripsAdapter.ts';
const time = (v: unknown) => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
const keys = [
  'id',
  'vessel_id',
  'watch_title',
  'start_time',
  'start_location',
  'destination',
  'notes',
  'for_date',
  'slots',
  'created_by',
  'created_at',
];
export function validWatchSlots(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((s) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
      if (
        Object.keys(s).some(
          (k) =>
            ![
              'crewId',
              'crewName',
              'crewPosition',
              'startTimeStr',
              'endTimeStr',
              'durationHours',
              'startDate',
              'endDate',
            ].includes(k)
        )
      )
        return false;
      if (
        typeof s.crewId !== 'string' ||
        !s.crewId ||
        typeof s.crewName !== 'string' ||
        ('crewPosition' in s && typeof s.crewPosition !== 'string') ||
        !time(s.startTimeStr) ||
        !time(s.endTimeStr) ||
        !Number.isFinite(s.durationHours) ||
        s.durationHours <= 0
      )
        return false;
      // Legacy rows omit both dates. New dated slots must describe an exact positive interval.
      if (!('startDate' in s) && !('endDate' in s)) return true;
      if (!validTripDate(s.startDate) || !validTripDate(s.endDate)) return false;
      const duration =
        (Date.parse(s.endDate + 'T' + s.endTimeStr + ':00Z') -
          Date.parse(s.startDate + 'T' + s.startTimeStr + ':00Z')) /
        3600000;
      return duration > 0 && Math.abs(duration - s.durationHours) <= 1 / 60 + 1e-9;
    })
  );
}
export const watchKeepingAdapter: OfflineAdapter = {
  serverFields: ['created_at'],
  validate: (v) =>
    keys.every((k) => k in v) &&
    Object.keys(v).every((k) => keys.includes(k)) &&
    ['id', 'vessel_id', 'watch_title', 'created_at'].every((k) => typeof v[k] === 'string') &&
    String(v.watch_title).trim().length > 0 &&
    time(v.start_time) &&
    ['start_location', 'destination', 'notes', 'created_by'].every(
      (k) => v[k] === null || typeof v[k] === 'string'
    ) &&
    (v.for_date === null || validTripDate(v.for_date)) &&
    validWatchSlots(v.slots),
  authorizeRead: (s, v) => v.vessel_id === s.vesselId,
  authorize: (s, kind, v, previous) =>
    v.vessel_id === s.vesselId &&
    (kind === 'create'
      ? v.created_by === s.userId
      : !!previous && ['id', 'vessel_id', 'created_by'].every((k) => v[k] === previous.value[k])),
};
export const watchRulesAdapter: OfflineAdapter = {
  serverFields: ['updated_at', 'updated_by'],
  validate: (v) =>
    ['id', 'vessel_id', 'content', 'updated_at', 'updated_by'].every((k) => k in v) &&
    Object.keys(v).every((k) =>
      ['id', 'vessel_id', 'content', 'updated_at', 'updated_by'].includes(k)
    ) &&
    ['id', 'vessel_id', 'content', 'updated_at'].every((k) => typeof v[k] === 'string') &&
    (v.updated_by === null || typeof v.updated_by === 'string'),
  authorizeRead: (s, v) => v.vessel_id === s.vesselId,
  authorize: (s, kind, v, previous) =>
    v.vessel_id === s.vesselId &&
    (kind === 'create'
      ? v.updated_by === s.userId
      : !!previous && ['id', 'vessel_id'].every((k) => v[k] === previous.value[k])),
};
export function watchDeviceCopy(v: RecordValue, id: string, userId: string): RecordValue {
  return {
    ...v,
    id,
    watch_title: String(v.watch_title) + ' (device copy)',
    created_by: userId,
    created_at: new Date().toISOString(),
  };
}
