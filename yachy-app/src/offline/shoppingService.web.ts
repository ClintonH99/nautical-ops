import type { OfflineShoppingService } from './shoppingService';
import { OfflineError } from './access';
import { sameShoppingFields } from './shoppingAdapter';
import {
  webOfflineEnabled,
  offlineNotesContext,
  saveOfflineRecord,
  deleteSyncedOfflineRecord,
  refreshOfflineFeature,
  subscribeOfflineNotes,
} from './runtime.web';
export const offlineShopping: OfflineShoppingService = {
  enabled: () => webOfflineEnabled,
  subscribe: subscribeOfflineNotes,
  refresh: () => refreshOfflineFeature('shoppingLists'),
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
  async update(id, value, version, base) {
    const a = await offlineNotesContext();
    const fields = Object.keys(value);
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await a.box.read('shoppingLists', id);
      if (!row) throw new OfflineError('LOCAL_CONFLICT');
      if (sameShoppingFields(row.value, value, fields))
        return { ...row.value, offlineLocalVersion: row.localVersion };
      // An upload acknowledgement can advance the version without an actual edit.
      // A changed base still requires the user to reconcile; never overwrite it.
      if (base ? !sameShoppingFields(row.value, base, fields) : row.localVersion !== version)
        throw new OfflineError('LOCAL_CONFLICT');
      try {
        return await saveOfflineRecord(
          'shoppingLists',
          { ...row.value, ...value },
          'update',
          row.localVersion
        );
      } catch (error) {
        if (!(error instanceof OfflineError) || error.code !== 'LOCAL_CONFLICT' || attempt === 2)
          throw error;
      }
    }
    throw new OfflineError('LOCAL_CONFLICT');
  },
  delete: (id, remove) => deleteSyncedOfflineRecord('shoppingLists', id, remove),
};
