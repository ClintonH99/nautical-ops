import type { OfflineAdapter, RecordValue, Json } from './outbox';
export function mergeChecklistItems(before: Json, next: Json, online: Json) {
  if (![before, next, online].every(Array.isArray)) return { value: next, conflict: true };
  const original = new Map((before as RecordValue[]).map((i) => [i.id, i]));
  const desired = new Map((next as RecordValue[]).map((i) => [i.id, i]));
  const merged = new Map((online as RecordValue[]).map((i) => [i.id, { ...i }]));
  let conflict = false;
  for (const [id] of original) if (!desired.has(id)) conflict = true;
  for (const [id, item] of desired) {
    const old = original.get(id),
      current = merged.get(id);
    if (!old) {
      if (current)
        conflict = true; // Never adopt an unrelated row with a reused ID.
      else merged.set(id, { ...item });
      continue;
    }
    if (!current) {
      conflict = true;
      continue;
    }
    for (const key of ['label', 'sort_order', 'checked']) {
      if (old[key] === item[key]) continue;
      if (current[key] !== old[key] && current[key] !== item[key]) conflict = true;
      current[key] = item[key];
    }
  }
  return {
    value: [...merged.values()].sort(
      (a, b) =>
        Number(a.sort_order) - Number(b.sort_order) || String(a.id).localeCompare(String(b.id))
    ),
    conflict,
  };
}
const fields = [
  'id',
  'vessel_id',
  'trip_id',
  'department',
  'title',
  'created_at',
  'created_by',
  'items',
];
const childFields = ['id', 'checklist_id', 'label', 'sort_order', 'checked', 'created_at'];
export const checklistsAdapter: OfflineAdapter = {
  serverFields: ['created_at'],
  mergeField: (key, before, next, online) =>
    key === 'items' ? mergeChecklistItems(before, next, online) : undefined,
  validate(v) {
    if (
      !fields.every((k) => k in v) ||
      !Object.keys(v).every((k) => fields.includes(k)) ||
      !['id', 'vessel_id', 'title', 'created_at'].every((k) => typeof v[k] === 'string') ||
      !['trip_id', 'created_by'].every((k) => v[k] === null || typeof v[k] === 'string') ||
      !(
        v.department === null ||
        ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'].includes(String(v.department))
      ) ||
      !Array.isArray(v.items)
    )
      return false;
    const ids = new Set();
    return v.items.every((i) => {
      if (
        !i ||
        typeof i !== 'object' ||
        Array.isArray(i) ||
        !childFields.every((k) => k in i) ||
        !Object.keys(i).every((k) => childFields.includes(k)) ||
        !['id', 'checklist_id', 'label', 'created_at'].every((k) => typeof i[k] === 'string') ||
        i.checklist_id !== v.id ||
        !Number.isInteger(i.sort_order) ||
        typeof i.checked !== 'boolean' ||
        ids.has(i.id)
      )
        return false;
      ids.add(i.id);
      return true;
    });
  },
  authorizeRead: (scope, v) => v.vessel_id === scope.vesselId,
  authorize: (scope, kind, v, previous) =>
    v.vessel_id === scope.vesselId &&
    typeof v.title === 'string' &&
    !!v.title.trim() &&
    (kind === 'create'
      ? v.created_by === scope.userId
      : !!previous && ['id', 'vessel_id', 'created_by'].every((k) => v[k] === previous.value[k])),
};
export function checklistDeviceCopy(v: RecordValue, id: string, userId: string): RecordValue {
  const now = new Date().toISOString();
  return {
    ...v,
    id,
    title: String(v.title) + ' (device copy)',
    created_by: userId,
    created_at: now,
    items: (v.items as RecordValue[]).map((i) => ({
      ...i,
      id: crypto.randomUUID(),
      checklist_id: id,
      created_at: now,
    })),
  };
}
