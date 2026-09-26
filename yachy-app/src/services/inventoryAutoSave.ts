import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../store';
import inventoryService from './inventory';
import { InventoryAutoSaveQueue } from '../utils/inventoryAutoSaveQueue';

const queues = new Map<string, InventoryAutoSaveQueue>();
export function getInventoryAutoSave(userId: string, vesselId: string) {
  const key = `nautical_ops_inventory_autosave_v1:${userId}:${vesselId}`;
  let queue = queues.get(key);
  if (!queue) {
    queue = new InventoryAutoSaveQueue({
      read: () => AsyncStorage.getItem(key),
      write: (value) => AsyncStorage.setItem(key, value),
      canSync: () => {
        const state = useAuthStore.getState();
        return (
          state.user?.id === userId &&
          state.user?.vesselId === vesselId &&
          !state.deferUserUpdate &&
          !state.captainPaymentRequired
        );
      },
      save: (entry, attempt) =>
        inventoryService.autoSave(
          entry.id,
          {
            ...attempt.values,
            vesselId,
            lastEditedByName: useAuthStore.getState().user?.name,
          },
          attempt.base
        ),
    });
    queues.set(key, queue);
  }
  return queue;
}
