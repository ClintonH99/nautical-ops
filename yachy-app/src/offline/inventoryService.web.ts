import { requireOnlineAction } from './onlineActions';
import type { OfflineInventoryService } from './inventoryService';
import { OfflineError } from './access';
import { sameInventoryContents } from './inventoryAdapter';
import {
  webOfflineEnabled,
  offlineNotesContext,
  saveOfflineRecord,
  syncOffline,
  subscribeOfflineNotes,
} from './runtime.web';
const conflict = () => {
  const e = new Error('Inventory changed elsewhere. Your draft is kept on this device.');
  e.name = 'InventoryConflictError';
  return e;
};
export const offlineInventory: OfflineInventoryService = {
  enabled: () => webOfflineEnabled,
  subscribe: subscribeOfflineNotes,
  refresh: syncOffline,
  async read(id, vesselId) {
    const a = await offlineNotesContext();
    if (vesselId && vesselId !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    const row = await a.box.read('inventory', id);
    return row ? { ...row.value, offlineLocalVersion: row.localVersion } : null;
  },
  async list(vesselId) {
    const a = await offlineNotesContext();
    if (vesselId !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    return (await a.box.list('inventory')).map((row) => ({
      ...row.value,
      offlineLocalVersion: row.localVersion,
    }));
  },
  async save(id, vesselId, value, base) {
    const a = await offlineNotesContext();
    if (vesselId !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    const row = await a.box.read('inventory', id);
    if (row && sameInventoryContents(row.value, value))
      return { ...row.value, offlineLocalVersion: row.localVersion };
    if (row && (!base || !sameInventoryContents(base, row.value))) throw conflict();
    if (!row && base) throw conflict();
    const now = new Date().toISOString();
    const record = {
      ...(row?.value ?? {
        id,
        vessel_id: vesselId,
        category_id: null,
        quantity: 0,
        photo: null,
        created_at: now,
      }),
      ...value,
      last_edited_by: a.scope.userId,
      last_edited_at: now,
    };
    try {
      return await saveOfflineRecord(
        'inventory',
        record,
        row ? 'update' : 'create',
        row?.localVersion ?? 0
      );
    } catch (e) {
      if (e instanceof OfflineError && e.code === 'LOCAL_CONFLICT') throw conflict();
      throw e;
    }
  },
  async beforeDelete(id) {
    requireOnlineAction();
    await syncOffline();
    requireOnlineAction();
    const a = await offlineNotesContext();
    if (
      (await a.store.read(a.scope)).changes.some(
        (c) => c.feature === 'inventory' && c.recordId === id
      )
    )
      throw new OfflineError('RECONCILE_FIRST');
  },
};
