import { requireOnlineAction } from './onlineActions';
import type { OfflineSeaMilesService } from './seaMilesService';
import type { RecordValue } from './outbox';
import { seaServerFields } from './seaMilesAdapter';
import { OfflineError } from './access';
import {
  webOfflineEnabled,
  offlineNotesContext,
  saveOfflineRecord,
  syncOffline,
  subscribeOfflineNotes,
} from './runtime.web';
export const offlineSeaMiles: OfflineSeaMilesService = {
  enabled: () => webOfflineEnabled,
  refresh: syncOffline,
  subscribe: subscribeOfflineNotes,
  async list(review = false) {
    const a = await offlineNotesContext();
    const features: ('seaMiles' | 'seaMilesReview')[] = review
      ? ['seaMiles', 'seaMilesReview']
      : ['seaMiles'];
    const b = await a.box.bundle(features);
    return features
      .flatMap((f) => b.records[f] ?? [])
      .map((r) => ({
        ...r.value,
        offlineLocalVersion: r.localVersion,
        offlinePending: b.pendingRecords.some((c) => c.recordId === r.value.id),
      }));
  },
  async read(id) {
    const a = await offlineNotesContext();
    return (
      (
        await this.list(a.permit?.claims.permissions.seaMilesReview?.includes('read') === true)
      ).find((r) => r.id === id) ?? null
    );
  },
  async context() {
    const a = await offlineNotesContext();
    await a.box.list('seaMiles');
    const c = (await a.store.read(a.scope)).seaMileContext;
    if (!c) throw new OfflineError('NOT_DOWNLOADED');
    return c;
  },
  async create(value) {
    const a = await offlineNotesContext();
    if (value.user_id !== a.scope.userId) throw new OfflineError('SCOPE_CHANGED');
    if (value.status === 'PENDING' && !(await this.context()).canSubmit)
      throw new Error('Reconnect to verify a Captain is available before submitting.');
    const v: RecordValue = {
      ...Object.fromEntries(seaServerFields.map((k) => [k, null])),
      ...value,
      id: crypto.randomUUID(),
      owner_name: '',
      review_vessel_id: value.status === 'PENDING' ? a.scope.vesselId : null,
      decline_comment: null,
      review_context_revision: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return saveOfflineRecord('seaMiles', v, 'create', 0);
  },
  async update(id, value, version) {
    const a = await offlineNotesContext(),
      existing = await this.read(id);
    if (!existing || version === undefined || Number(existing.offlineLocalVersion) !== version)
      throw new OfflineError('LOCAL_CONFLICT');
    const { offlineLocalVersion: _, offlinePending: pending, ...old } = existing;
    if (['PENDING', 'DECLINED', 'APPROVED'].includes(String(old.status)) && pending)
      throw new Error('Sync this entry before making another review or correction.');
    const c = await this.context();
    if (value.status === 'PENDING' && old.status !== 'PENDING' && !c.canSubmit)
      throw new Error('Reconnect to verify a Captain is available before submitting.');
    if (value.status === 'APPROVED' && (!c.hasSignature || !c.contact))
      throw new Error('Set up your signature and Captain contact details online before approving.');
    const v: RecordValue = { ...old, ...value };
    if (old.status !== 'PENDING') {
      v.review_vessel_id = value.status === 'PENDING' ? a.scope.vesselId : null;
      v.decline_comment = null;
    }
    if (value.status === 'APPROVED') v.review_context_revision = c.reviewRevision;
    await saveOfflineRecord(
      old.user_id === a.scope.userId ? 'seaMiles' : 'seaMilesReview',
      v,
      'update',
      version
    );
  },
  async beforeOnline() {
    requireOnlineAction();
    await syncOffline();
    requireOnlineAction();
    const a = await offlineNotesContext();
    await a.box.list('seaMiles');
    if (
      (await a.store.read(a.scope)).changes.some((c) =>
        ['seaMiles', 'seaMilesReview'].includes(c.feature)
      )
    )
      throw new OfflineError('RECONCILE_FIRST');
  },
};
