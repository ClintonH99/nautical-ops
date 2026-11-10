import { requireOnlineAction } from './onlineActions';
import type { OfflineShoppingService } from './shoppingService';
import { OfflineError } from './access';
import {
  webOfflineEnabled,
  offlineNotesContext,
  saveOfflineRecord,
  syncOffline,
  subscribeOfflineNotes,
} from './runtime.web';
export const offlineShopping: OfflineShoppingService = {
  enabled: () => webOfflineEnabled,
  subscribe: subscribeOfflineNotes,
  async list(vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) throw new OfflineError('SCOPE_CHANGED');
    return (await a.box.list('shoppingLists')).map((row) => ({
      ...row.value,
      offlineLocalVersion: row.localVersion,
    }));
  },
  async create(value) {
    const a = await offlineNotesContext();
    if (value.vessel_id !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    return saveOfflineRecord(
      'shoppingLists',
      {
        ...value,
        id: crypto.randomUUID(),
        created_by: a.scope.userId,
        created_at: new Date().toISOString(),
      },
      'create',
      0
    );
  },
  async update(id, value, version) {
    const a = await offlineNotesContext();
    const row = await a.box.read('shoppingLists', id);
    if (!row || version === undefined || row.localVersion !== version)
      throw new OfflineError('LOCAL_CONFLICT');
    return saveOfflineRecord('shoppingLists', { ...row.value, ...value }, 'update', version);
  },
  async beforeDelete(id) {
    requireOnlineAction();
    await syncOffline();
    requireOnlineAction();
    const a = await offlineNotesContext();
    if (
      (await a.store.read(a.scope)).changes.some(
        (change) => change.feature === 'shoppingLists' && change.recordId === id
      )
    )
      throw new OfflineError('RECONCILE_FIRST');
  },
};
