import type { OfflineAdapter } from './outbox';
const fields = [
  'id',
  'vessel_id',
  'user_id',
  'title',
  'content',
  'created_by_name',
  'created_at',
  'updated_at',
];
export const notesAdapter: OfflineAdapter = {
  serverFields: ['created_at', 'updated_at'],
  validate: (value) =>
    fields.every((key) => typeof value[key] === 'string') &&
    Object.keys(value).every((key) => fields.includes(key)) &&
    ['id', 'vessel_id', 'user_id'].every((key) => /^[0-9a-f-]{36}$/i.test(value[key] as string)),
  authorizeRead: (scope, value) =>
    value.user_id === scope.userId && value.vessel_id === scope.vesselId,
  authorize: (scope, _kind, value, previous) =>
    value.user_id === scope.userId &&
    value.vessel_id === scope.vesselId &&
    (!previous ||
      (previous.value.user_id === scope.userId &&
        previous.value.vessel_id === scope.vesselId &&
        previous.value.id === value.id)),
};
