import type { OfflineAdapter, RecordValue } from './outbox';
export const inventoryEditable = [
  'department',
  'title',
  'description',
  'location',
  'items',
] as const;
const fields = [
  'id',
  'category_id',
  'name',
  'description',
  'quantity',
  'location',
  'department',
  'vessel_id',
  'photo',
  'last_edited_by',
  'last_edited_by_name',
  'last_edited_at',
  'created_at',
  'items',
  'title',
];
export const inventoryAdapter: OfflineAdapter = {
  serverFields: ['last_edited_by', 'last_edited_by_name', 'last_edited_at', 'created_at'],
  validate(v) {
    return (
      fields.every((k) => k in v) &&
      Object.keys(v).every((k) => fields.includes(k)) &&
      ['id', 'name', 'location', 'department', 'vessel_id', 'last_edited_by_name', 'title'].every(
        (k) => typeof v[k] === 'string'
      ) &&
      [
        'category_id',
        'description',
        'photo',
        'last_edited_by',
        'last_edited_at',
        'created_at',
      ].every((k) => v[k] === null || typeof v[k] === 'string') &&
      Number.isInteger(v.quantity) &&
      ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'].includes(String(v.department)) &&
      Array.isArray(v.items) &&
      v.items.every(
        (row) =>
          row &&
          typeof row === 'object' &&
          !Array.isArray(row) &&
          Object.keys(row).length === 2 &&
          typeof row.amount === 'string' &&
          typeof row.item === 'string'
      )
    );
  },
  authorizeRead: (scope, v) => v.vessel_id === scope.vesselId,
  authorize: (scope, kind, v, previous) =>
    v.vessel_id === scope.vesselId &&
    typeof v.title === 'string' &&
    !!v.title.trim() &&
    v.name === v.title &&
    (kind === 'create'
      ? v.category_id === null && v.photo === null && v.quantity === 0
      : !!previous &&
        ['id', 'vessel_id', 'category_id', 'photo', 'quantity'].every(
          (k) => v[k] === previous.value[k]
        )),
};
export function inventoryDeviceCopy(v: RecordValue, id: string): RecordValue {
  const title = String(v.title || v.name) + ' (device copy)';
  return {
    ...v,
    id,
    title,
    name: title,
    category_id: null,
    photo: null,
    quantity: 0,
    last_edited_by: null,
    last_edited_at: null,
    created_at: new Date().toISOString(),
  };
}

/** PostgreSQL JSON object key order is not an edit; inventory row order is. */
export function sameInventoryContents(a: RecordValue, b: RecordValue): boolean {
  return inventoryEditable.every((k) => {
    if (k !== 'items') return (a[k] ?? '') === (b[k] ?? '');
    const otherItems = b.items;
    if (
      !Array.isArray(a.items) ||
      !Array.isArray(otherItems) ||
      a.items.length !== otherItems.length
    )
      return false;
    return a.items.every((row, index) => {
      const other = otherItems[index];
      return (
        row &&
        other &&
        typeof row === 'object' &&
        typeof other === 'object' &&
        !Array.isArray(row) &&
        !Array.isArray(other) &&
        row.amount === other.amount &&
        row.item === other.item
      );
    });
  });
}
