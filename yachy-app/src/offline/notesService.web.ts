import { requireOnlineAction } from './onlineActions';
import type { OfflineNotesService } from './notesService';
import type { Note } from '../services/notes';
import { OfflineError } from './access';
import {
  webOfflineEnabled,
  offlineNotesContext,
  readOfflineNotes,
  saveOfflineNote,
  syncOffline,
  subscribeOfflineNotes,
} from './runtime.web';
export const offlineNotes: OfflineNotesService = {
  enabled: () => webOfflineEnabled,
  subscribe: subscribeOfflineNotes,
  async list(userId) {
    const a = await offlineNotesContext();
    if (a.scope.userId !== userId) throw new OfflineError('SCOPE_CHANGED');
    return (await readOfflineNotes()).sort((a, b) =>
      String(b.updated_at).localeCompare(String(a.updated_at))
    ) as unknown as Note[];
  },
  async get(id) {
    const a = await offlineNotesContext();
    const row = await a.box.read('notes', id);
    return row
      ? ({ ...row.value, offlineLocalVersion: row.localVersion } as unknown as Note)
      : null;
  },
  async create(vesselId, userId, title, content, name) {
    const a = await offlineNotesContext();
    if (a.scope.userId !== userId || a.scope.vesselId !== vesselId)
      throw new OfflineError('SCOPE_CHANGED');
    const now = new Date().toISOString();
    return (await saveOfflineNote(
      {
        id: crypto.randomUUID(),
        vessel_id: vesselId,
        user_id: userId,
        title,
        content,
        created_by_name: name,
        created_at: now,
        updated_at: now,
      },
      'create',
      0
    )) as unknown as Note;
  },
  async update(id, title, content, version) {
    const a = await offlineNotesContext();
    const row = await a.box.read('notes', id);
    if (!row || version === undefined || row.localVersion !== version)
      throw new OfflineError('LOCAL_CONFLICT');
    return (await saveOfflineNote(
      { ...row.value, title, content, updated_at: new Date().toISOString() },
      'update',
      version
    )) as unknown as Note;
  },
  async beforeDelete(id) {
    requireOnlineAction();
    await syncOffline();
    requireOnlineAction();
    const a = await offlineNotesContext();
    if ((await a.store.read(a.scope)).changes.some((change) => change.recordId === id))
      throw new OfflineError('RECONCILE_FIRST');
  },
};
