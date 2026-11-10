import { OfflineError, scopeKey } from './access.ts';
import type { OfflineScope, OfflineFeature } from './access.ts';
import { emptyPartition } from './outbox.ts';
import type { Partition, PendingChange, RecordValue } from './outbox.ts';
export type RecoveryOptions = {
  draft?: (feature: OfflineFeature, value: RecordValue) => boolean;
  copy?: (feature: OfflineFeature, value: RecordValue) => boolean;
};
const hasDraft = (value: RecordValue) => {
  // Inventory persists its preferences and clean entries too. Those are not
  // unfinished work and must not prevent an earlier session's draft recovery.
  if (value.entries && typeof value.entries === 'object' && !Array.isArray(value.entries)) {
    const entries = value.entries as Record<string, RecordValue>;
    if (typeof value.newItemId === 'string' && entries[value.newItemId]) return true;
    return Object.values(entries).some(
      (entry) => entry && (!entry.base || entry.attempt || entry.version !== entry.savedVersion)
    );
  }
  return Object.keys(value).length > 0;
};

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
    .reduce(
      (sum, [, state]) =>
        sum +
        state.changes.length +
        Object.values(state.drafts ?? {}).filter((d) => d && hasDraft(d.value)).length +
        (state.recoveryCopies?.length ?? 0),
      0
    );
}
/** Pure transaction plan; caller must reauthorize online before applying it. */
export function planRecovery(
  entries: [string, Partition][],
  scope: OfflineScope,
  allowed: (change: PendingChange) => boolean,
  options: RecoveryOptions = {}
): { updates: [string, Partition][]; moved: number } {
  const targetKey = scopeKey(scope),
    target = structuredClone(entries.find(([key]) => key === targetKey)?.[1] ?? emptyPartition());
  const updates: [string, Partition][] = [];
  let moved = 0;
  for (const [key, original] of entries) {
    if (!earlierSessionKey(key, scope)) continue;
    const source = structuredClone(original);
    let changed = false;
    const groups = new Set(
      source.changes.map((change) => JSON.stringify([change.feature, change.recordId]))
    );
    for (const groupKey of groups) {
      const group = source.changes.filter(
        (change) => JSON.stringify([change.feature, change.recordId]) === groupKey
      );
      const ids = new Set(group.map((change) => change.id));
      if (
        !group.every(allowed) ||
        target.changes.some(
          (change) =>
            JSON.stringify([change.feature, change.recordId]) === groupKey && !ids.has(change.id)
        )
      )
        continue;
      if (group.some((change) => change.afterId && !ids.has(change.afterId)))
        throw new OfflineError('RECOVERY_CONFLICT');
      for (const change of group) {
        const duplicate = target.changes.find((item) => item.id === change.id);
        if (duplicate) {
          const payload = (item: PendingChange) =>
            JSON.stringify([
              item.feature,
              item.recordId,
              item.kind,
              item.value,
              item.baseRevision,
              item.afterId,
            ]);
          if (payload(duplicate) !== payload(change)) throw new OfflineError('RECOVERY_CONFLICT');
        } else {
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
        changed = true;
        moved++;
      }
    }
    for (const [feature, draft] of Object.entries(source.drafts ?? {})) {
      const f = feature as OfflineFeature;
      if (!draft || !hasDraft(draft.value) || !options.draft?.(f, draft.value)) continue;
      const current = target.drafts?.[f];
      // A new-session draft is never replaced by older unfinished work.
      if (current && hasDraft(current.value)) continue;
      target.drafts ??= {};
      target.drafts[f] = {
        value: structuredClone(draft.value),
        version: Math.max(draft.version, current?.version ?? 0) + 1,
      };
      delete source.drafts![f];
      changed = true;
      moved++;
      target.highestObservedMs = Math.max(target.highestObservedMs, source.highestObservedMs);
    }
    for (const copy of [...(source.recoveryCopies ?? [])]) {
      if (!options.copy?.(copy.feature, copy.value)) continue;
      target.recoveryCopies ??= [];
      const existing = target.recoveryCopies.find((c) => c.id === copy.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(copy))
        throw new OfflineError('RECOVERY_CONFLICT');
      if (!existing) target.recoveryCopies.push(copy);
      source.recoveryCopies = source.recoveryCopies!.filter((c) => c.id !== copy.id);
      changed = true;
      moved++;
    }
    if (changed) updates.push([key, source]);
  }
  if (moved) updates.push([targetKey, target]);
  return { updates, moved };
}
