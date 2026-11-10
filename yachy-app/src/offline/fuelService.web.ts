import { requireOnlineAction } from './onlineActions';
import type { OfflineFuelService } from './fuelService';
import { fuelFeatures, fuelFields } from './fuelAdapter';
import type { RecordValue } from './outbox';
import { OfflineError } from './access';
import {
  offlineNotesContext,
  subscribeOfflineNotes,
  saveOfflineRecord,
  syncOffline,
  webOfflineEnabled,
} from './runtime.web';
export const offlineFuel: OfflineFuelService = {
  enabled: () => webOfflineEnabled,
  subscribe: subscribeOfflineNotes,
  async context(vesselId) {
    const a = await offlineNotesContext();
    if (vesselId && vesselId !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    await a.box.list('fuelLogs');
    const c = (await a.store.read(a.scope)).fuelContext;
    if (!c) throw new OfflineError('NOT_DOWNLOADED');
    return c;
  },
  async list(feature, vesselId) {
    const a = await offlineNotesContext();
    if (vesselId && vesselId !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    const b = await a.box.bundle([feature]);
    return (b.records[feature] ?? []).map((r) => ({
      ...r.value,
      offlineLocalVersion: r.localVersion,
      offlinePending: b.pendingRecords.some((p) => p.recordId === r.value.id),
    }));
  },
  async read(feature, id) {
    return (await this.list(feature)).find((r) => r.id === id || r.source_id === id) ?? null;
  },
  async save(feature, vesselId, patch, entries, id, version, reason = '') {
    const a = await offlineNotesContext();
    if (vesselId !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    let value: RecordValue;
    if (id) {
      const old = await this.read(feature, id);
      if (!old || version === undefined || old.offlineLocalVersion !== version)
        throw new OfflineError('LOCAL_CONFLICT');
      const { offlineLocalVersion: _, offlinePending: __, ...record } = old;
      value = {
        ...record,
        fields: {
          ...(record.fields as RecordValue),
          ...Object.fromEntries(
            Object.entries(patch).filter(([k]) =>
              (fuelFields[feature] as readonly string[]).includes(k)
            )
          ),
        },
        entries,
        amendment_reason: reason,
      };
    } else {
      value = {
        id: crypto.randomUUID(),
        vessel_id: vesselId,
        source_id: null,
        fields: Object.fromEntries(fuelFields[feature].map((k) => [k, patch[k] ?? null])),
        entries,
        server: {
          created_at: new Date().toISOString(),
          created_by: a.scope.userId,
          created_by_name: '',
          inventory_revision: 0,
        },
        amendment_reason: '',
      };
    }
    const saved = await saveOfflineRecord(feature, value, id ? 'update' : 'create', version ?? 0);
    return { ...saved, offlinePending: true };
  },
  async beforeOnline(feature, id) {
    requireOnlineAction();
    await syncOffline();
    requireOnlineAction();
    const a = await offlineNotesContext();
    await a.box.list('fuelLogs');
    if (
      (await a.store.read(a.scope)).changes.some((c) =>
        (fuelFeatures as readonly string[]).includes(c.feature)
      )
    )
      throw new OfflineError('RECONCILE_FIRST');
    if (feature && id) {
      const r = await this.read(feature, id);
      return String(r?.source_id ?? id);
    }
    return id;
  },
};
