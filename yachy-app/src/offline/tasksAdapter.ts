import type { OfflineAdapter, RecordValue } from './outbox';
const fields = [
  'id',
  'vessel_id',
  'category',
  'department',
  'title',
  'notes',
  'done_by_date',
  'status',
  'created_by',
  'created_at',
  'updated_at',
  'completed_by',
  'completed_at',
  'completed_by_name',
  'recurring',
];
const nullable = (v: unknown) => v === null || typeof v === 'string';
export const tasksAdapter: OfflineAdapter = {
  serverFields: ['created_at', 'updated_at'],
  validate: (v) =>
    fields.every((k) => k in v) &&
    Object.keys(v).every((k) => fields.includes(k)) &&
    ['id', 'vessel_id', 'title', 'created_at', 'updated_at'].every(
      (k) => typeof v[k] === 'string'
    ) &&
    String(v.title).trim().length > 0 &&
    [
      'notes',
      'done_by_date',
      'created_by',
      'completed_by',
      'completed_at',
      'completed_by_name',
      'recurring',
    ].every((k) => nullable(v[k])) &&
    ['DAILY', 'WEEKLY', 'MONTHLY'].includes(String(v.category)) &&
    ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'].includes(String(v.department)) &&
    ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'].includes(String(v.status)) &&
    (v.done_by_date === null || /^\d{4}-\d{2}-\d{2}$/.test(String(v.done_by_date))) &&
    (v.status === 'COMPLETED' ||
      (v.category === 'DAILY'
        ? v.recurring === null
        : v.done_by_date !== null &&
          (v.category === 'WEEKLY' ? ['7_DAYS', '14_DAYS'] : ['14_DAYS', '30_DAYS']).includes(
            String(v.recurring)
          ))),
  authorizeRead: (s, v) => s.vesselId === v.vessel_id,
  authorize: (s, kind, v, previous) => {
    if (s.vesselId !== v.vessel_id) return false;
    if (kind === 'create')
      return (
        v.created_by === s.userId &&
        (v.status === 'COMPLETED'
          ? v.completed_by === s.userId &&
            typeof v.completed_at === 'string' &&
            typeof v.completed_by_name === 'string'
          : v.completed_by === null && v.completed_at === null && v.completed_by_name === null)
      );
    if (!previous || ['id', 'vessel_id', 'created_by'].some((k) => v[k] !== previous.value[k]))
      return false;
    // Unmarking completed tasks is an existing manager-only server action.
    if (previous.value.status === 'COMPLETED')
      return (
        v.status === 'COMPLETED' &&
        ['completed_by', 'completed_at', 'completed_by_name'].every(
          (k) => v[k] === previous.value[k]
        )
      );
    return v.status === 'COMPLETED'
      ? v.completed_by === s.userId &&
          typeof v.completed_at === 'string' &&
          typeof v.completed_by_name === 'string'
      : v.completed_by === null && v.completed_at === null && v.completed_by_name === null;
  },
};
export function taskDeviceCopy(value: RecordValue, id: string, userId: string): RecordValue {
  // A conflict copy is a new active task, never a second completion record.
  const category = String(value.category);
  const recurring =
    category === 'DAILY'
      ? null
      : category === 'WEEKLY'
        ? value.recurring === '14_DAYS'
          ? '14_DAYS'
          : '7_DAYS'
        : value.recurring === '14_DAYS'
          ? '14_DAYS'
          : '30_DAYS';
  return {
    ...value,
    id,
    created_by: userId,
    title: String(value.title) + ' (device copy)',
    status: 'NOT_STARTED',
    completed_by: null,
    completed_at: null,
    completed_by_name: null,
    recurring,
    done_by_date: recurring
      ? (value.done_by_date ?? new Date().toISOString().slice(0, 10))
      : value.done_by_date,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
