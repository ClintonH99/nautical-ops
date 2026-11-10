import type { OfflineDocuments } from './documentService';
import { offlineNotesContext, webOfflineEnabled } from './runtime.web';
import { OfflineError, scopeKey } from './access';
export const offlineDocuments: OfflineDocuments = {
  enabled: () => webOfflineEnabled,
  async scope() {
    return scopeKey((await offlineNotesContext()).scope);
  },
  async context() {
    const a = await offlineNotesContext();
    await a.box.list('restEntries');
    const c = (await a.store.read(a.scope)).documentContext;
    if (!c) throw new OfflineError('NOT_DOWNLOADED');
    return c;
  },
  async image(url) {
    const a = await offlineNotesContext();
    const key = new URL(url);
    key.search = '';
    return (await a.store.read(a.scope)).media?.[key.href] ?? null;
  },
  async help() {
    const a = await offlineNotesContext();
    return (await a.store.read(a.scope)).helpFaqs ?? null;
  },
  async updates() {
    const a = await offlineNotesContext();
    return (await a.store.read(a.scope)).appUpdates ?? null;
  },
};
