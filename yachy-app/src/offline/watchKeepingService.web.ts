import { requireOnlineAction } from './onlineActions';
import type { OfflineWatchService } from './watchKeepingService';
import { OfflineError } from './access';
import {
  webOfflineEnabled,
  offlineNotesContext,
  saveOfflineRecord,
  syncOffline,
  subscribeOfflineNotes,
} from './runtime.web';
export const offlineWatch: OfflineWatchService = {
  enabled: () => webOfflineEnabled,
  refresh: syncOffline,
  subscribe: subscribeOfflineNotes,
  async canCreate() {
    const a = await offlineNotesContext();
    await a.box.list('watchKeeping');
    return a.permit?.claims.permissions.watchKeeping?.includes('create') === true;
  },
  async roster(vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) throw new OfflineError('SCOPE_CHANGED');
    await a.box.list('watchKeeping');
    const rows = (await a.store.read(a.scope)).crewRoster;
    if (!rows) throw new OfflineError('NOT_DOWNLOADED');
    return rows;
  },
  async list(feature, vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) throw new OfflineError('SCOPE_CHANGED');
    return (await a.box.list(feature)).map((row) => ({
      ...row.value,
      offlineLocalVersion: row.localVersion,
    }));
  },
  async read(feature, id) {
    const a = await offlineNotesContext();
    const row = await a.box.read(feature, id);
    return row ? { ...row.value, offlineLocalVersion: row.localVersion } : null;
  },
  async create(feature, value, requestId) {
    const a = await offlineNotesContext();
    if (value.vessel_id !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    const id = requestId ?? crypto.randomUUID(),
      now = new Date().toISOString();
    const row =
      feature === 'watchKeeping'
        ? { ...value, id, created_by: a.scope.userId, created_at: now }
        : { ...value, id, updated_by: a.scope.userId, updated_at: now };
    return saveOfflineRecord(feature, row, 'create', 0);
  },
  async update(feature, id, value, version) {
    const a = await offlineNotesContext();
    const row = await a.box.read(feature, id);
    if (!row || version === undefined || row.localVersion !== version)
      throw new OfflineError('LOCAL_CONFLICT');
    return saveOfflineRecord(feature, { ...row.value, ...value }, 'update', version);
  },
  async beforeDelete(id) {
    requireOnlineAction();
    await syncOffline();
    requireOnlineAction();
    const a = await offlineNotesContext();
    if (
      (await a.store.read(a.scope)).changes.some(
        (c) => c.feature === 'watchKeeping' && c.recordId === id
      )
    )
      throw new OfflineError('RECONCILE_FIRST');
  },
};
