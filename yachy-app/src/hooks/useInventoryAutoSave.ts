import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '../store';
import { getInventoryAutoSave } from '../services/inventoryAutoSave';

export function useInventoryAutoSave() {
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const vesselId = useAuthStore((s) => s.user?.vesselId ?? '');
  const queue = useMemo(() => getInventoryAutoSave(userId, vesselId), [userId, vesselId]);
  const state = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  useEffect(() => {
    void queue.load();
  }, [queue]);
  return { queue, state };
}

/** Continues retrying pending Inventory writes after leaving the form; never switches account scope. */
export function InventoryAutoSaveSync() {
  const { queue } = useInventoryAutoSave();
  useEffect(() => {
    const retry = () => {
      void queue.load().then(() => queue.flush());
    };
    retry();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') retry();
    }, 15_000);
    const listener = AppState.addEventListener('change', () => retry());
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [queue]);
  return null;
}
