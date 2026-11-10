import type { OfflineVesselRecordService } from './vesselRecordService';
import type { VesselRecordFeature } from './vesselRecordAdapter';
import { useAuthStore } from '../store';
import { OfflineError } from './access';
import {
  webOfflineEnabled,
  offlineNotesContext,
  saveOfflineRecord,
  syncOffline,
  subscribeOfflineNotes,
} from './runtime.web';
export const offlineVesselRecords = (feature: VesselRecordFeature): OfflineVesselRecordService => ({
  enabled: () => webOfflineEnabled,
  refresh: syncOffline,
  subscribe: subscribeOfflineNotes,
  async read(id) {
    const a = await offlineNotesContext();
    const row = await a.box.read(feature, id);
    return row ? { ...row.value, offlineLocalVersion: row.localVersion } : null;
  },
  async list(vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) throw new OfflineError('SCOPE_CHANGED');
    return (await a.box.list(feature)).map((row) => ({
      ...row.value,
      offlineLocalVersion: row.localVersion,
    }));
  },
  async create(value) {
    const a = await offlineNotesContext();
    if (value.vessel_id !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    return saveOfflineRecord(
      feature,
      {
        ...value,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        ...(feature === 'uniforms'
          ? { created_by: a.scope.userId, updated_at: new Date().toISOString() }
          : { created_by_name: useAuthStore.getState().user?.name ?? '' }),
      },
      'create',
      0
    );
  },
  async update(id, value, version) {
    const a = await offlineNotesContext();
    const row = await a.box.read(feature, id);
    if (!row || version === undefined || row.localVersion !== version)
      throw new OfflineError('LOCAL_CONFLICT');
    return saveOfflineRecord(feature, { ...row.value, ...value }, 'update', version);
  },
  async beforeDelete(id) {
    if (!navigator.onLine) throw new OfflineError('ONLINE_ONLY');
    await syncOffline();
    const a = await offlineNotesContext();
    if (
      (await a.store.read(a.scope)).changes.some(
        (change) => change.feature === feature && change.recordId === id
      )
    )
      throw new OfflineError('RECONCILE_FIRST');
  },
});
