import { requireOnlineAction } from './onlineActions';
import type { OfflineDutiesService } from './watchDutiesService';
import type { RecordValue } from './outbox';
import { OfflineError } from './access';
import {
  webOfflineEnabled,
  offlineNotesContext,
  saveOfflineRecord,
  syncOffline,
  subscribeOfflineNotes,
} from './runtime.web';
export const offlineDuties: OfflineDutiesService = {
  enabled: () => webOfflineEnabled,
  subscribe: subscribeOfflineNotes,
  refresh: syncOffline,
  async roster(vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) throw new OfflineError('SCOPE_CHANGED');
    await a.box.list('watchAssignments');
    const rows = (await a.store.read(a.scope)).crewRoster;
    if (!rows) throw new OfflineError('NOT_DOWNLOADED');
    return rows;
  },
  async list(feature, vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) throw new OfflineError('SCOPE_CHANGED');
    return (await a.box.list(feature)).map((r) => ({
      ...r.value,
      offlineLocalVersion: r.localVersion,
    }));
  },
  async create(feature, value) {
    const a = await offlineNotesContext();
    if (value.vessel_id !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    const id = feature === 'watchDutyRules' ? a.scope.vesselId : crypto.randomUUID(),
      now = new Date().toISOString();
    const v: RecordValue = {
      ...value,
      id,
      [feature === 'watchDutyRules' ? 'updated_at' : 'created_at']: now,
    };
    if (feature === 'watchDuties')
      v.items = (value.items as RecordValue[]).map((i, n) => ({
        id: crypto.randomUUID(),
        group_id: id,
        label: i.label,
        sort_order: n,
        created_at: now,
      }));
    if (
      feature === 'watchAssignments' &&
      !(await this.roster(a.scope.vesselId)).some((u) => u.id === value.user_id)
    )
      throw new OfflineError('NOT_DOWNLOADED');
    return saveOfflineRecord(feature, v, 'create', 0);
  },
  async update(feature, id, value, version) {
    const a = await offlineNotesContext(),
      r = await a.box.read(feature, id);
    if (!r || version === undefined || r.localVersion !== version)
      throw new OfflineError('LOCAL_CONFLICT');
    return saveOfflineRecord(feature, { ...r.value, ...value }, 'update', version);
  },
  async check(userId, itemId, checked, expected) {
    const a = await offlineNotesContext();
    if (userId !== a.scope.userId) throw new OfflineError('SCOPE_CHANGED');
    const bundle = await a.box.bundle(['watchDuties', 'watchDutyChecks']);
    const parent = bundle.records.watchDuties?.find((r) =>
      (r.value.items as RecordValue[]).some((i) => i.id === itemId)
    );
    if (!parent) throw new OfflineError('NOT_DOWNLOADED');
    // A new item must reach the server before its personal checkmark can sync. Existing outbox ordering preserves creation order.
    const r = bundle.records.watchDutyChecks?.find((r) => r.value.item_id === itemId),
      current = r?.value.checked ?? false;
    if (current === checked) return;
    if (expected === undefined || current !== expected) throw new OfflineError('LOCAL_CONFLICT');
    const v = {
      id: itemId,
      vessel_id: a.scope.vesselId,
      user_id: userId,
      item_id: itemId,
      checked,
      updated_at: new Date().toISOString(),
    };
    await saveOfflineRecord('watchDutyChecks', v, r ? 'update' : 'create', r?.localVersion ?? 0);
  },
  async beforeDelete() {
    requireOnlineAction();
    await syncOffline();
    requireOnlineAction();
    const a = await offlineNotesContext();
    await a.box.list('watchDuties');
    if (
      (await a.store.read(a.scope)).changes.some((c) =>
        ['watchDuties', 'watchDutyRules', 'watchDutyChecks', 'watchAssignments'].includes(c.feature)
      )
    )
      throw new OfflineError('RECONCILE_FIRST');
  },
};
