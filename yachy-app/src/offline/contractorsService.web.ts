import type { OfflineContractorsService } from './contractorsService';
import { OfflineError } from './access';
import {
  webOfflineEnabled,
  offlineNotesContext,
  saveOfflineRecord,
  syncOffline,
  subscribeOfflineNotes,
} from './runtime.web';
export const offlineContractors: OfflineContractorsService = {
  enabled: () => webOfflineEnabled,
  refresh: syncOffline,
  subscribe: subscribeOfflineNotes,
  async read(id) {
    const a = await offlineNotesContext();
    const row = await a.box.read('contractors', id);
    return row ? { ...row.value, offlineLocalVersion: row.localVersion } : null;
  },
  async list(vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) throw new OfflineError('SCOPE_CHANGED');
    return (await a.box.list('contractors')).map((row) => ({
      ...row.value,
      offlineLocalVersion: row.localVersion,
    }));
  },
  async create(value) {
    const a = await offlineNotesContext();
    if (value.vessel_id !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    return saveOfflineRecord(
      'contractors',
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
    const row = await a.box.read('contractors', id);
    if (!row || version === undefined || row.localVersion !== version)
      throw new OfflineError('LOCAL_CONFLICT');
    return saveOfflineRecord('contractors', { ...row.value, ...value }, 'update', version);
  },
  async beforeDelete(id) {
    if (!navigator.onLine) throw new OfflineError('ONLINE_ONLY');
    await syncOffline();
    const a = await offlineNotesContext();
    if (
      (await a.store.read(a.scope)).changes.some(
        (change) => change.feature === 'contractors' && change.recordId === id
      )
    )
      throw new OfflineError('RECONCILE_FIRST');
  },
};
