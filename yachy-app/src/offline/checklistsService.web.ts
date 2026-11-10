import type { OfflineChecklistsService } from './checklistsService';
import type { RecordValue, LocalRecord } from './outbox';
import { OfflineError } from './access';
import {
  webOfflineEnabled,
  offlineNotesContext,
  saveOfflineRecord,
  syncOffline,
  subscribeOfflineNotes,
} from './runtime.web';
async function display(row: LocalRecord) {
  const a = await offlineNotesContext();
  const trip = row.value.trip_id ? await a.box.read('trips', String(row.value.trip_id)) : null;
  return { ...row.value, trip: trip?.value ?? null, offlineLocalVersion: row.localVersion };
}
async function validTrip(id: unknown) {
  if (!id) return;
  const a = await offlineNotesContext();
  if (!(await a.box.read('trips', String(id)))) throw new OfflineError('NOT_DOWNLOADED');
}
export const offlineChecklists: OfflineChecklistsService = {
  enabled: () => webOfflineEnabled,
  subscribe: subscribeOfflineNotes,
  refresh: syncOffline,
  async list(vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) throw new OfflineError('SCOPE_CHANGED');
    return Promise.all((await a.box.list('preDepartureChecklists')).map(display));
  },
  async read(id) {
    const a = await offlineNotesContext(),
      row = await a.box.read('preDepartureChecklists', id);
    return row ? display(row) : null;
  },
  async create(value) {
    const a = await offlineNotesContext();
    if (value.vessel_id !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    await validTrip(value.trip_id);
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    const record = {
      ...value,
      id,
      created_by: a.scope.userId,
      created_at: now,
      items: (value.items as RecordValue[]).map((item, index) => ({
        id: crypto.randomUUID(),
        checklist_id: id,
        label: item.label,
        sort_order: index,
        checked: false,
        created_at: now,
      })),
    };
    const result = await saveOfflineRecord('preDepartureChecklists', record, 'create', 0);
    return { ...result, trip: null };
  },
  async update(id, value, version) {
    const a = await offlineNotesContext(),
      row = await a.box.read('preDepartureChecklists', id);
    if (!row || version === undefined || version !== row.localVersion)
      throw new OfflineError('LOCAL_CONFLICT');
    await validTrip('trip_id' in value ? value.trip_id : row.value.trip_id);
    return saveOfflineRecord(
      'preDepartureChecklists',
      { ...row.value, ...value },
      'update',
      version
    );
  },
  async add(id, label, version) {
    const a = await offlineNotesContext(),
      row = await a.box.read('preDepartureChecklists', id);
    if (!row || version === undefined || version !== row.localVersion)
      throw new OfflineError('LOCAL_CONFLICT');
    const items = row.value.items as RecordValue[];
    const child = {
      id: crypto.randomUUID(),
      checklist_id: id,
      label: label.trim(),
      sort_order: Math.max(-1, ...items.map((i) => Number(i.sort_order))) + 1,
      checked: false,
      created_at: new Date().toISOString(),
    };
    const result = await saveOfflineRecord(
      'preDepartureChecklists',
      { ...row.value, items: [...items, child] },
      'update',
      version
    );
    return { ...child, offlineLocalVersion: result.offlineLocalVersion };
  },
  async check(itemId, checked, expected) {
    const a = await offlineNotesContext();
    const row = (await a.box.list('preDepartureChecklists')).find((r) =>
      (r.value.items as RecordValue[]).some((i) => i.id === itemId)
    );
    if (!row) throw new OfflineError('NOT_DOWNLOADED');
    const items = row.value.items as RecordValue[],
      item = items.find((i) => i.id === itemId)!;
    if (item.checked === checked) return;
    if (expected === undefined || item.checked !== expected)
      throw new OfflineError('LOCAL_CONFLICT');
    await saveOfflineRecord(
      'preDepartureChecklists',
      { ...row.value, items: items.map((i) => (i.id === itemId ? { ...i, checked } : i)) },
      'update',
      row.localVersion
    );
  },
  async beforeDelete(id, isItem) {
    if (!navigator.onLine) throw new OfflineError('ONLINE_ONLY');
    await syncOffline();
    const a = await offlineNotesContext();
    const rowId = isItem
      ? (await a.box.list('preDepartureChecklists')).find((r) =>
          (r.value.items as RecordValue[]).some((i) => i.id === id)
        )?.value.id
      : id;
    if (!rowId) throw new OfflineError('NOT_DOWNLOADED');
    if (
      (await a.store.read(a.scope)).changes.some(
        (c) => c.feature === 'preDepartureChecklists' && c.recordId === rowId
      )
    )
      throw new OfflineError('RECONCILE_FIRST');
  },
};
