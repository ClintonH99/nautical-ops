import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../store';
import { getInventoryAutoSave as legacyQueue } from './inventoryAutoSaveLegacy';
import inventoryService from './inventory';
import { InventoryAutoSaveQueue } from '../utils/inventoryAutoSaveQueue';
import { OfflineError, scopeKey } from '../offline/access';
import {
  beginDeviceSave,
  offlineNotesContext,
  syncOffline,
  useOfflineStatus,
  webOfflineEnabled,
} from '../offline/runtime.web';
const queues = new Map<string, InventoryAutoSaveQueue>();
export function getInventoryAutoSave(userId: string, vesselId: string, partitionKey = '') {
  if (!webOfflineEnabled) return legacyQueue(userId, vesselId);
  const key = JSON.stringify([userId, vesselId, partitionKey]);
  let queue = queues.get(key);
  if (queue) return queue;
  let revision: number | null = null;
  const context = async () => {
    const a = await offlineNotesContext();
    if (
      a.scope.userId !== userId ||
      a.scope.vesselId !== vesselId ||
      scopeKey(a.scope) !== partitionKey
    )
      throw new OfflineError('SCOPE_CHANGED');
    return a;
  };
  queue = new InventoryAutoSaveQueue({
    async read() {
      const a = await context();
      const draft = await a.box.readDraft('inventory');
      revision = draft.version;
      if (draft.version) return JSON.stringify(draft.value);
      // Preserve the previous Auto Save queue. Import only after fresh online checks;
      // keep its source untouched, and let exact record/base comparisons detect conflicts.
      const old = await AsyncStorage.getItem(
        `nautical_ops_inventory_autosave_v1:${userId}:${vesselId}`
      );
      if (old) {
        await syncOffline();
        if (useOfflineStatus.getState().disconnected || !useOfflineStatus.getState().ready)
          throw new OfflineError('ONLINE_CHECK_REQUIRED');
        const current = await context();
        await current.box.list('inventory');
        const value = JSON.parse(old);
        revision = await current.box.writeDraft('inventory', value, 0);
        return old;
      }
      return null;
    },
    async write(value) {
      const finish = beginDeviceSave();
      try {
        const a = await context();
        if (revision === null) throw new OfflineError('LOCAL_STORAGE_UNAVAILABLE');
        revision = await a.box.writeDraft('inventory', JSON.parse(value), revision);
      } finally {
        finish();
      }
    },
    canSync() {
      const auth = useAuthStore.getState(),
        status = useOfflineStatus.getState();
      return (
        auth.user?.id === userId &&
        auth.user?.vesselId === vesselId &&
        !auth.deferUserUpdate &&
        !auth.captainPaymentRequired &&
        !auth.crewPaymentRequired &&
        status.ready &&
        status.partitionKey === partitionKey
      );
    },
    async save(entry, attempt) {
      await context();
      return inventoryService.autoSave(
        entry.id,
        { ...attempt.values, vesselId, lastEditedByName: useAuthStore.getState().user?.name },
        attempt.base
      );
    },
  });
  queues.set(key, queue);
  return queue;
}
