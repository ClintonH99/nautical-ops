import type { OfflineAdapter, RecordValue } from './outbox';
const fields = [
  'id',
  'vessel_id',
  'department',
  'title',
  'items',
  'created_at',
  'created_by',
  'list_type',
  'is_master',
];
const departments = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];
export const shoppingAdapter: OfflineAdapter = {
  validate: (value) =>
    fields.every((key) => key in value) &&
    Object.keys(value).every((key) => fields.includes(key)) &&
    ['id', 'vessel_id', 'created_at', 'title'].every((key) => typeof value[key] === 'string') &&
    (value.created_by === null || typeof value.created_by === 'string') &&
    typeof value.is_master === 'boolean' &&
    departments.includes(String(value.department)) &&
    ['general', 'trip'].includes(String(value.list_type)) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof item.text === 'string' &&
        typeof item.checked === 'boolean' &&
        (!('amount' in item) || typeof item.amount === 'string') &&
        Object.keys(item).every((key) => ['text', 'checked', 'amount'].includes(key))
    ),
  authorizeRead: (scope, value) => scope.vesselId === value.vessel_id,
  authorize: (scope, kind, value, previous) =>
    scope.vesselId === value.vessel_id &&
    (kind === 'create'
      ? value.created_by === scope.userId
      : !!previous &&
        ['id', 'vessel_id', 'department', 'list_type', 'is_master', 'created_by'].every(
          (key) => value[key] === previous.value[key]
        )),
};
export function shoppingDeviceCopy(value: RecordValue, id: string, userId: string): RecordValue {
  return {
    ...value,
    id,
    created_by: userId,
    title: String(value.title) + ' (device copy)',
    created_at: new Date().toISOString(),
    is_master: false,
  };
}
