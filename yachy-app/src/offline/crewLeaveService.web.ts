import { requireOnlineAction } from './onlineActions';
import type { OfflineCrewLeaveService } from './crewLeaveService';
import { OfflineError } from './access';
import {
  webOfflineEnabled,
  offlineNotesContext,
  saveOfflineRecord,
  syncOffline,
  subscribeOfflineNotes,
} from './runtime.web';
export const offlineCrewLeave: OfflineCrewLeaveService = {
  enabled: () => webOfflineEnabled,
  async roster(vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) throw new OfflineError('SCOPE_CHANGED');
    await a.box.list('crewLeave');
    const crew = (await a.store.read(a.scope)).crewRoster;
    if (!crew) throw new OfflineError('NOT_DOWNLOADED');
    return crew;
  },
  refresh: syncOffline,
  subscribe: subscribeOfflineNotes,
  async read(id) {
    const a = await offlineNotesContext();
    const row = await a.box.read('crewLeave', id);
    return row ? { ...row.value, offlineLocalVersion: row.localVersion } : null;
  },
  async list(vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) throw new OfflineError('SCOPE_CHANGED');
    return (await a.box.list('crewLeave')).map((row) => ({
      ...row.value,
      offlineLocalVersion: row.localVersion,
    }));
  },
  async create(value) {
    const a = await offlineNotesContext();
    if (value.vessel_id !== a.scope.vesselId) throw new OfflineError('SCOPE_CHANGED');
    const snapshot = await crewSnapshot(a.scope.vesselId, value.crew_member_id);
    return saveOfflineRecord(
      'crewLeave',
      {
        ...value,
        ...snapshot,
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
    const row = await a.box.read('crewLeave', id);
    if (!row || version === undefined || row.localVersion !== version)
      throw new OfflineError('LOCAL_CONFLICT');
    const snapshot =
      value.crew_member_id && value.crew_member_id !== row.value.crew_member_id
        ? await crewSnapshot(a.scope.vesselId, value.crew_member_id)
        : {};
    return saveOfflineRecord(
      'crewLeave',
      { ...row.value, ...value, ...snapshot },
      'update',
      version
    );
  },
  async beforeDelete(id) {
    requireOnlineAction();
    await syncOffline();
    requireOnlineAction();
    const a = await offlineNotesContext();
    if (
      (await a.store.read(a.scope)).changes.some(
        (change) => change.feature === 'crewLeave' && change.recordId === id
      )
    )
      throw new OfflineError('RECONCILE_FIRST');
  },
};

async function crewSnapshot(vesselId: string, id: unknown) {
  const member = (await offlineCrewLeave.roster(vesselId)).find((m) => m.id === id);
  if (!member) throw new OfflineError('NOT_DOWNLOADED');
  return {
    crew_member_name_snapshot: member.name,
    crew_member_position_snapshot: member.position,
    crew_member_departments_snapshot: [
      ...new Set(
        [member.department, member.department_2].filter((d): d is string => typeof d === 'string')
      ),
    ],
  };
}
