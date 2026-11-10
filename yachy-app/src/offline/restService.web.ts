import type { OfflineRestService } from './restService';
import type { RecordValue } from './outbox';
import { OfflineError } from './access';
import { validTripDate } from './tripsAdapter';
import {
  webOfflineEnabled,
  offlineNotesContext,
  saveOfflineRecord,
  subscribeOfflineNotes,
} from './runtime.web';
export const offlineRest: OfflineRestService = {
  enabled: () => webOfflineEnabled,
  subscribe: subscribeOfflineNotes,
  async list(userId) {
    const a = await offlineNotesContext();
    const features: ('restEntries' | 'restReview')[] =
      userId === a.scope.userId
        ? ['restEntries']
        : userId
          ? ['restReview']
          : ['restEntries', 'restReview'];
    const data = await a.box.bundle(features);
    return features
      .flatMap((f) => data.records[f]!)
      .filter((r) => !userId || r.value.user_id === userId)
      .map((r) => ({
        ...r.value,
        offlineLocalVersion: r.localVersion,
        offlinePending: data.pendingRecords.some((c) => c.recordId === r.value.id),
      }));
  },
  async roster(vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) throw new OfflineError('SCOPE_CHANGED');
    await a.box.list('restReview');
    const rows = (await a.store.read(a.scope)).crewRoster;
    if (!rows) throw new OfflineError('NOT_DOWNLOADED');
    return rows;
  },
  async canManage(userId, vesselId) {
    const a = await offlineNotesContext();
    if (a.scope.vesselId !== vesselId) return false;
    if (!a.permit?.claims.permissions.restReview?.includes('update')) return false;
    return (await this.roster(vesselId)).some((m) => m.id === userId);
  },
  async hasSignature(userId) {
    const a = await offlineNotesContext();
    if (userId !== a.scope.userId) throw new OfflineError('ACTION_NOT_ALLOWED');
    const data = await a.box.bundle(['restEntries']);
    if (data.restSignature === undefined) throw new OfflineError('NOT_DOWNLOADED');
    return data.restSignature;
  },
  async editor(userId, date) {
    if (!validTripDate(date)) throw new OfflineError('INVALID_RECORD');
    const a = await offlineNotesContext();
    const feature = userId === a.scope.userId ? 'restEntries' : 'restReview';
    const data = await a.box.bundle([feature, 'watchKeeping']);
    const row = data.records[feature]!.find(
      (r) => r.value.user_id === userId && r.value.date === date
    );
    const watches = data.records.watchKeeping!;
    return {
      entry: row
        ? {
            ...row.value,
            offlineLocalVersion: row.localVersion,
            offlinePending: data.pendingRecords.some((c) => c.recordId === row.value.id),
          }
        : null,
      watchRows: watches.map((r) => r.value),
      watchVersions: Object.fromEntries(
        watches.filter((r) => r.serverRevision).map((r) => [String(r.value.id), r.serverRevision!])
      ),
      watchPending: data.pending.includes('watchKeeping'),
    };
  },
  async save(value, version, watchVersions) {
    const a = await offlineNotesContext();
    const userId = String(value.user_id),
      date = String(value.date);
    if (!validTripDate(date) || value.vessel_id !== a.scope.vesselId)
      throw new OfflineError('SCOPE_CHANGED');
    const feature = userId === a.scope.userId ? 'restEntries' : 'restReview';
    const current = await this.editor(userId, date);
    if (value.status === 'confirmed' && current.watchPending)
      throw new Error(
        'Sync the pending watch schedule before confirming these hours. Your entered times remain here.'
      );
    if (!(await this.hasSignature(a.scope.userId)))
      throw new Error('Set up your E-Signature online before saving Hours of Rest.');
    if ((Number(current.entry?.offlineLocalVersion) || 0) !== version)
      throw new OfflineError('LOCAL_CONFLICT');
    // Stable per-user/date identity makes simultaneous new drafts use the same CAS target.
    const bytes = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          a.scope.projectId + ':' + a.scope.vesselId + ':' + userId + ':' + date
        )
      )
    );
    const hex = Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
    const id = String(
      current.entry?.id ??
        `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    );
    const now = new Date().toISOString();
    const existing = { ...current.entry };
    delete existing.offlineLocalVersion;
    delete existing.offlinePending;
    const row: RecordValue = {
      ...existing,
      ...value,
      id,
      comment: value.comment ?? null,
      confirmed_by: value.status === 'confirmed' ? a.scope.userId : null,
      confirmed_at: value.status === 'confirmed' ? now : null,
      created_at: existing.created_at ?? now,
      updated_at: existing.updated_at ?? now,
      watch_versions: watchVersions,
    };
    return saveOfflineRecord(feature, row, current.entry ? 'update' : 'create', version);
  },
};
