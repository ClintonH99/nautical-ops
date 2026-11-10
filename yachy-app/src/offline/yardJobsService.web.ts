import { requireOnlineAction } from './onlineActions';
import type { OfflineYardJobsService } from './yardJobsService';
import { OfflineError } from './access';
import {
  webOfflineEnabled,
  offlineNotesContext,
  saveOfflineRecord,
  syncOffline,
  subscribeOfflineNotes,
} from './runtime.web';
export const offlineYardJobs: OfflineYardJobsService = {
  enabled: () => webOfflineEnabled,
  async folders(vesselId) {
    const a = await offlineNotesContext();
    if (vesselId && vesselId !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    await a.box.list('yardJobs'); // Includes current signed access and snapshot readiness.
    const value = (await a.store.read(a.scope)).shipyardFolders;
    if (!value) throw new OfflineError('SNAPSHOT_UNAVAILABLE');
    return value;
  },
  async beforeOnlineAction() {
    requireOnlineAction();
    await syncOffline();
    requireOnlineAction();
    const a = await offlineNotesContext();
    if ((await a.store.read(a.scope)).changes.some((change) => change.feature === 'yardJobs'))
      throw new OfflineError('RECONCILE_FIRST');
  },
  refresh: syncOffline,
  subscribe: subscribeOfflineNotes,
  async read(id) {
    const a = await offlineNotesContext();
    const row = await a.box.read('yardJobs', id);
    return row ? { ...row.value, offlineLocalVersion: row.localVersion } : null;
  },
  async list(vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) throw new OfflineError('SCOPE_CHANGED');
    return (await a.box.list('yardJobs')).map((row) => ({
      ...row.value,
      offlineLocalVersion: row.localVersion,
    }));
  },
  async create(value) {
    const a = await offlineNotesContext();
    if (value.vessel_id !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    return saveOfflineRecord(
      'yardJobs',
      {
        ...value,
        id: crypto.randomUUID(),
        created_by: a.scope.userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      'create',
      0
    );
  },
  async update(id, value, version) {
    const a = await offlineNotesContext();
    const row = await a.box.read('yardJobs', id);
    if (!row || version === undefined || row.localVersion !== version)
      throw new OfflineError('LOCAL_CONFLICT');
    return saveOfflineRecord('yardJobs', { ...row.value, ...value }, 'update', version);
  },
  async beforeDelete(id) {
    requireOnlineAction();
    await syncOffline();
    requireOnlineAction();
    const a = await offlineNotesContext();
    if (
      (await a.store.read(a.scope)).changes.some(
        (change) => change.feature === 'yardJobs' && change.recordId === id
      )
    )
      throw new OfflineError('RECONCILE_FIRST');
  },
};
