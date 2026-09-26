import type { Dispatch, SetStateAction } from 'react';
import { finishPendingRemoval, getScreenCacheGeneration, hidePendingRecord } from './screenCache';

/** Remove immediately after confirmation; restore only this record if the server rejects it. */
export async function optimisticDelete<T extends { id: string }>(
  item: T,
  setItems: Dispatch<SetStateAction<T[]>>,
  remove: () => Promise<unknown>
) {
  const generation = getScreenCacheGeneration();
  let index = 0;
  hidePendingRecord(item.id);
  setItems((current) => {
    index = Math.max(
      0,
      current.findIndex((row) => row.id === item.id)
    );
    return current.filter((row) => row.id !== item.id);
  });
  try {
    await remove();
    if (generation === getScreenCacheGeneration()) finishPendingRemoval(item.id, true);
  } catch (error) {
    if (generation === getScreenCacheGeneration()) {
      finishPendingRemoval(item.id, false);
      setItems((current) => {
        if (current.some((row) => row.id === item.id)) return current;
        const restored = [...current];
        restored.splice(Math.min(index, restored.length), 0, item);
        return restored;
      });
    }
    throw error;
  }
}
