import { requireOnlineAction } from './onlineActions';
import type { OfflineTripsService } from './tripsService';
import { OfflineError } from './access';
import {
  webOfflineEnabled,
  offlineNotesContext,
  saveOfflineRecord,
  syncOffline,
  subscribeOfflineNotes,
} from './runtime.web';
export const offlineTrips: OfflineTripsService = {
  enabled: () => webOfflineEnabled,
  async colors(vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) throw new OfflineError('SCOPE_CHANGED');
    return (await a.store.read(a.scope)).tripColors ?? null;
  },
  refresh: syncOffline,
  subscribe: subscribeOfflineNotes,
  async read(id) {
    const a = await offlineNotesContext();
    const row = await a.box.read('trips', id);
    return row ? { ...row.value, offlineLocalVersion: row.localVersion } : null;
  },
  async list(vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) throw new OfflineError('SCOPE_CHANGED');
    return (await a.box.list('trips')).map((row) => ({
      ...row.value,
      offlineLocalVersion: row.localVersion,
    }));
  },
  async create(value) {
    const a = await offlineNotesContext();
    if (value.vessel_id !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    return saveOfflineRecord(
      'trips',
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
    const row = await a.box.read('trips', id);
    if (!row || version === undefined || row.localVersion !== version)
      throw new OfflineError('LOCAL_CONFLICT');
    return saveOfflineRecord('trips', { ...row.value, ...value }, 'update', version);
  },
  async beforeDelete(id) {
    requireOnlineAction();
    await syncOffline();
    requireOnlineAction();
    const a = await offlineNotesContext();
    if (
      (await a.store.read(a.scope)).changes.some(
        (change) => change.feature === 'trips' && change.recordId === id
      )
    )
      throw new OfflineError('RECONCILE_FIRST');
  },
};
