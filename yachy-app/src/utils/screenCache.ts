/** Memory-only presentation cache. Never shared across accounts, vessels or permissions. */
let scope = '';
let generation = 0;
const entries = new Map<string, { value: unknown; at: number }>();
const removals = new Map<string, number>();
const MAX_AGE = 15 * 60_000;
export const getScreenCacheGeneration = () => generation;
export function setScreenCacheScope(next: string) {
  if (scope === next) return;
  scope = next;
  generation += 1;
  entries.clear();
  removals.clear();
}
export function hidePendingRecord(id: string) {
  removals.set(id, Infinity);
}
export function finishPendingRemoval(id: string, success: boolean) {
  if (success) removals.set(id, Date.now() + 30_000);
  else removals.delete(id);
}
export function withoutPendingRemovals<T>(value: T): T {
  if (!Array.isArray(value) || !removals.size) return value;
  const result = value.filter((item) => {
    if (!item || typeof item !== 'object' || !('id' in item)) return true;
    const until = removals.get(item.id);
    if (until === undefined) return true;
    if (until < Date.now()) {
      removals.delete(item.id);
      return true;
    }
    return false;
  });
  return (result.length === value.length ? value : result) as T;
}
export function readScreenCache<T>(key: string): T | undefined {
  const entry = entries.get(key);
  if (!entry || Date.now() - entry.at > MAX_AGE) {
    entries.delete(key);
    return undefined;
  }
  return withoutPendingRemovals(entry.value as T);
}
export function writeScreenCache(key: string, value: unknown, expectedGeneration: number) {
  if (expectedGeneration !== generation) return;
  entries.delete(key);
  entries.set(key, { value, at: Date.now() });
  if (entries.size > 250) entries.delete(entries.keys().next().value!);
}
