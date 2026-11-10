import { OfflineError, scopeKey } from './access.ts';
import type { OfflineScope } from './access.ts';
import { emptyPartition } from './outbox.ts';
import type { Partition, PendingChange } from './outbox.ts';

export function earlierSessionKey(key: unknown, scope: OfflineScope): boolean {
  if (typeof key !== 'string' || key === scopeKey(scope)) return false;
  try {
    const stored = JSON.parse(key),
      current = JSON.parse(scopeKey(scope));
    return (
      Array.isArray(stored) &&
      stored.length === 6 &&
      stored.slice(0, 5).every((part, index) => part === current[index]) &&
      typeof stored[5] === 'string'
    );
  } catch {
    return false;
  }
}
export function recoveryCount(entries: [string, Partition][], scope: OfflineScope): number {
  return entries
    .filter(([key]) => earlierSessionKey(key, scope))
    .reduce((sum, [, state]) => sum + state.changes.length, 0);
}
/** Pure transaction plan; caller must reauthorize online before applying it. */
export function planRecovery(
  entries: [string, Partition][],
  scope: OfflineScope,
  allowed: (change: PendingChange) => boolean
): { updates: [string, Partition][]; moved: number } {
  const targetKey = scopeKey(scope),
    target = structuredClone(entries.find(([key]) => key === targetKey)?.[1] ?? emptyPartition());
  const updates: [string, Partition][] = [];
  let moved = 0;
  for (const [key, original] of entries) {
    if (!earlierSessionKey(key, scope)) continue;
    const source = structuredClone(original);
    for (const change of [...source.changes]) {
      if (!allowed(change)) continue;
      const duplicate = target.changes.find((item) => item.id === change.id);
      if (duplicate) {
        const payload = (item: PendingChange) =>
          JSON.stringify([item.feature, item.recordId, item.kind, item.value, item.baseRevision]);
        if (payload(duplicate) !== payload(change)) throw new OfflineError('RECOVERY_CONFLICT');
      } else {
        // Leave two independently edited copies for explicit reconciliation.
        if (
          target.changes.some(
            (item) => item.feature === change.feature && item.recordId === change.recordId
          )
        )
          continue;
        const recordKey = JSON.stringify([change.feature, change.recordId]);
        const localVersion =
          Math.max(change.localVersion, target.records[recordKey]?.localVersion ?? 0) + 1;
        target.changes.push({
          ...change,
          localVersion,
          state: change.state === 'conflict' ? 'conflict' : 'pending',
          claim: null,
          claimUntil: 0,
        });
        target.records[recordKey] = {
          value: structuredClone(change.value),
          serverRevision: change.baseRevision,
          localVersion,
        };
        target.highestObservedMs = Math.max(target.highestObservedMs, source.highestObservedMs);
      }
      source.changes = source.changes.filter((item) => item.id !== change.id);
      moved++;
    }
    if (source.changes.length !== original.changes.length) updates.push([key, source]);
  }
  if (moved) updates.push([targetKey, target]);
  return { updates, moved };
}
