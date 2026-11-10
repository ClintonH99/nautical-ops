import type { OfflineAdapter, RecordValue } from './outbox';
import { requireOfflineAccess } from './access.ts';
import { validTripDate } from './tripsAdapter.ts';
const fields = [
  'id',
  'vessel_id',
  'user_id',
  'date',
  'rest_periods',
  'work_start',
  'work_end',
  'lunch_start',
  'lunch_end',
  'comment',
  'status',
  'confirmed_by',
  'confirmed_at',
  'created_at',
  'updated_at',
  'watch_versions',
];
const time = (v: unknown) => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
export function validRest(value: RecordValue): boolean {
  return (
    fields.every((k) => k in value) &&
    Object.keys(value).every((k) => fields.includes(k)) &&
    ['id', 'vessel_id', 'user_id', 'created_at', 'updated_at'].every(
      (k) => typeof value[k] === 'string'
    ) &&
    validTripDate(value.date) &&
    ['work_start', 'work_end', 'lunch_start', 'lunch_end'].every(
      (k) => value[k] === null || time(value[k])
    ) &&
    ['comment', 'confirmed_by', 'confirmed_at'].every(
      (k) => value[k] === null || typeof value[k] === 'string'
    ) &&
    ['draft', 'pending_confirmation', 'confirmed', 'needs_reconfirmation'].includes(
      String(value.status)
    ) &&
    Array.isArray(value.rest_periods) &&
    value.rest_periods.every(
      (p) =>
        !!p &&
        typeof p === 'object' &&
        !Array.isArray(p) &&
        Object.keys(p).length === 2 &&
        time(p.start) &&
        time(p.end)
    ) &&
    !!value.watch_versions &&
    typeof value.watch_versions === 'object' &&
    !Array.isArray(value.watch_versions) &&
    Object.entries(value.watch_versions).every(
      ([id, rev]) =>
        /^[0-9a-f-]{36}$/i.test(id) && typeof rev === 'string' && /^[0-9a-f]{32}$/.test(rev)
    )
  );
}
export function restAdapter(review: boolean): OfflineAdapter {
  return {
    serverFields: ['created_at', 'updated_at'],
    mergeField: (key, _before, next) =>
      ['confirmed_by', 'confirmed_at'].includes(key) ? { value: next, conflict: false } : undefined,
    validate: validRest,
    authorizeRead: (s, v) =>
      v.vessel_id === s.vesselId && (review ? v.user_id !== s.userId : v.user_id === s.userId),
    authorize: (s, kind, v, previous, context) => {
      if (v.vessel_id !== s.vesselId || (review ? v.user_id === s.userId : v.user_id !== s.userId))
        return false;
      let captain = false;
      try {
        if (context) {
          requireOfflineAccess(context, 'restReview', 'update');
          captain = true;
        }
      } catch {
        /* signed authority only */
      }
      if (review && !captain) return false;
      if (
        kind === 'update' &&
        (!previous ||
          ['id', 'vessel_id', 'user_id', 'date'].some((k) => v[k] !== previous.value[k]))
      )
        return false;
      if (
        !captain &&
        (v.status === 'confirmed' ||
          ['confirmed', 'pending_confirmation'].includes(String(previous?.value.status)))
      )
        return false;
      if (v.comment !== previous?.value.comment && String(v.comment ?? '').length > 20)
        return false;
      if (v.status === 'confirmed') return captain && v.confirmed_by === s.userId;
      return v.confirmed_by === null && v.confirmed_at === null;
    },
  };
}
