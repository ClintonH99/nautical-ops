import { OfflineError, requireOfflineAccess, sameScope, scopeKey } from './access.ts';
import type { OfflineContext, OfflineFeature, OfflineScope } from './access.ts';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type RecordValue = { [key: string]: Json };
export type LocalRecord = {
  value: RecordValue;
  serverRevision: string | null;
  localVersion: number;
};
export type OfflineMutation = {
  id: string;
  feature: OfflineFeature;
  recordId: string;
  kind: 'create' | 'update';
  value: RecordValue;
  baseRevision: string | null;
};
export type PendingChange = OfflineMutation & {
  /** Local-only dependency; never transmitted before its parent is acknowledged. */
  afterId?: string;
  localVersion: number;
  state: 'pending' | 'sending' | 'conflict' | 'blocked';
  attempts: number;
  claim: string | null;
  claimUntil: number;
};
export type Partition = {
  snapshots?: Partial<Record<OfflineFeature, boolean>>;
  schema: 1;
  highestObservedMs: number;
  records: Record<string, LocalRecord>;
  changes: PendingChange[];
};
export const emptyPartition = (): Partition => ({
  schema: 1,
  highestObservedMs: 0,
  records: {},
  changes: [],
});
/** update must be a single durable, cross-tab transaction. Never await in change. */
export interface OfflineStore {
  read(scope: OfflineScope): Promise<Partition>;
  update<T>(scope: OfflineScope, change: (state: Partition) => T): Promise<T>;
}
export type SyncResult =
  | {
      status: 'applied';
      operationId: string;
      recordId: string;
      revision: string;
      value: RecordValue;
    }
  | { status: 'conflict' | 'forbidden' | 'retry' };
export interface OfflineTransport {
  /** Implementations must atomically deduplicate IDs and compare base revisions. */
  protocol: 'offline-mutation-v1';
  revalidate(scope: OfflineScope): Promise<boolean>;
  apply(scope: OfflineScope, change: Readonly<OfflineMutation>): Promise<SyncResult>;
}
export type OfflineAdapter = {
  /** Server-maintained fields never form part of a later local edit delta. */
  serverFields?: readonly string[];
  authorizeRead: (scope: OfflineScope, value: RecordValue) => boolean;
  /** Validate permitted fields AND row-level constraints for this exact user. */
  authorize: (
    scope: OfflineScope,
    kind: 'create' | 'update',
    value: RecordValue,
    previous: LocalRecord | null
  ) => boolean;
  validate: (value: RecordValue) => boolean;
};
const keyFor = (feature: OfflineFeature, id: string) => JSON.stringify([feature, id]);
const validId = (id: string) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
function snapshot(value: RecordValue): RecordValue {
  function visit(x: unknown, depth: number): void {
    if (depth > 20) throw new OfflineError('INVALID_RECORD');
    if (x === null || typeof x === 'string' || typeof x === 'boolean') return;
    if (typeof x === 'number' && Number.isFinite(x)) return;
    if (Array.isArray(x)) {
      x.forEach((v) => visit(v, depth + 1));
      return;
    }
    if (x && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype) {
      for (const [k, v] of Object.entries(x)) {
        if (['__proto__', 'constructor', 'prototype'].includes(k))
          throw new OfflineError('INVALID_RECORD');
        visit(v, depth + 1);
      }
      return;
    }
    throw new OfflineError('INVALID_RECORD');
  }
  if (!value || Array.isArray(value) || typeof value !== 'object')
    throw new OfflineError('INVALID_RECORD');
  visit(value, 0);
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > 256_000)
    throw new OfflineError('RECORD_TOO_LARGE');
  return JSON.parse(encoded);
}

/** Not wired to the app until real access issuer, adapters and sync server pass E2E. */
export class OfflineOutbox {
  async list(feature: OfflineFeature): Promise<LocalRecord[]> {
    const scope = { ...this.context().scope };
    await this.checkpoint(scope);
    return this.store.update(scope, (state) => {
      this.check(scope, state, feature, 'read');
      if (!state.snapshots?.[feature]) throw new OfflineError('NOT_DOWNLOADED');
      const adapter = this.adapters[feature];
      if (!adapter) throw new OfflineError('FEATURE_NOT_READY');
      const records = Object.entries(state.records)
        .filter(([key]) => JSON.parse(key)[0] === feature)
        .map(([, record]) => record);
      if (
        records.some(
          (record) => !adapter.validate(record.value) || !adapter.authorizeRead(scope, record.value)
        )
      )
        throw new OfflineError('ACTION_NOT_ALLOWED');
      return structuredClone(records);
    });
  }
  /** A complete permission-filtered snapshot, not a partial/paginated result. */
  async replaceSnapshot(
    feature: OfflineFeature,
    rows: { recordId: string; value: RecordValue; revision: string }[]
  ): Promise<void> {
    const scope = { ...this.context().scope };
    const adapter = this.adapters[feature];
    if (!adapter) throw new OfflineError('FEATURE_NOT_READY');
    const safe = rows.map((row) => ({ ...row, value: snapshot(row.value) }));
    if (
      new Set(safe.map((row) => row.recordId)).size !== safe.length ||
      safe.some(
        (row) =>
          !validId(row.recordId) ||
          !row.revision ||
          !adapter.validate(row.value) ||
          !adapter.authorizeRead(scope, row.value)
      )
    )
      throw new OfflineError('INVALID_RECORD');
    await this.checkpoint(scope);
    await this.store.update(scope, (state) => {
      this.check(scope, state, feature, 'read');
      const pending = new Set(
        state.changes
          .filter((change) => change.feature === feature)
          .map((change) => change.recordId)
      );
      for (const key of Object.keys(state.records)) {
        const [savedFeature, id] = JSON.parse(key);
        if (
          savedFeature === feature &&
          !pending.has(id) &&
          !safe.some((row) => row.recordId === id)
        )
          delete state.records[key];
      }
      for (const row of safe) {
        if (pending.has(row.recordId)) continue;
        const key = keyFor(feature, row.recordId);
        if (
          state.records[key]?.serverRevision === row.revision &&
          JSON.stringify(state.records[key]?.value) === JSON.stringify(row.value)
        )
          continue;
        state.records[key] = {
          value: row.value,
          serverRevision: row.revision,
          localVersion: (state.records[key]?.localVersion ?? 0) + 1,
        };
      }
      state.snapshots = { ...state.snapshots, [feature]: true };
    });
  }
  private store: OfflineStore;
  private context: () => OfflineContext;
  private adapters: Partial<Record<OfflineFeature, OfflineAdapter>>;
  private newId: () => string;
  constructor(options: {
    store: OfflineStore;
    context: () => OfflineContext;
    adapters: Partial<Record<OfflineFeature, OfflineAdapter>>;
    newId?: () => string;
  }) {
    this.store = options.store;
    this.context = options.context;
    this.adapters = options.adapters;
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }
  private bound(scope: OfflineScope): OfflineContext {
    const c = this.context();
    if (!sameScope(scope, c.scope)) throw new OfflineError('SCOPE_CHANGED');
    if (c.blocked) throw new OfflineError('ACCESS_BLOCKED');
    return c;
  }
  private check(
    scope: OfflineScope,
    state: Partition,
    feature: OfflineFeature,
    action: 'read' | 'create' | 'update'
  ) {
    const c = this.bound(scope);
    requireOfflineAccess(
      { ...c, highestObservedMs: Math.max(c.highestObservedMs, state.highestObservedMs) },
      feature,
      action
    );
    state.highestObservedMs = Math.max(c.nowMs, c.highestObservedMs, state.highestObservedMs);
  }
  private async checkpoint(scope: OfflineScope): Promise<void> {
    // Commit the observed time even when a subsequent expired-access check fails.
    // Otherwise an expiry followed by clock rollback could reopen the old permit.
    await this.store.update(scope, (state) => {
      const c = this.bound(scope);
      if (
        ![c.nowMs, c.highestObservedMs, state.highestObservedMs].every(
          (n) => Number.isSafeInteger(n) && n >= 0
        )
      ) {
        throw new OfflineError('CLOCK_CHECK_REQUIRED');
      }
      state.highestObservedMs = Math.max(c.nowMs, c.highestObservedMs, state.highestObservedMs);
    });
  }
  async read(feature: OfflineFeature, recordId: string): Promise<LocalRecord | null> {
    const scope = { ...this.context().scope };
    await this.checkpoint(scope);
    return this.store.update(scope, (state) => {
      this.check(scope, state, feature, 'read');
      const record = state.records[keyFor(feature, recordId)] ?? null;
      const adapter = this.adapters[feature];
      if (!adapter) throw new OfflineError('FEATURE_NOT_READY');
      if (
        record &&
        (!adapter.validate(record.value) || !adapter.authorizeRead(scope, record.value))
      ) {
        throw new OfflineError('ACTION_NOT_ALLOWED');
      }
      return structuredClone(record);
    });
  }
  /** Caller supplies an authenticated, permission-filtered server snapshot. */
  async cache(
    feature: OfflineFeature,
    recordId: string,
    value: RecordValue,
    revision: string
  ): Promise<boolean> {
    const scope = { ...this.context().scope };
    const data = snapshot(value);
    if (!validId(recordId) || typeof revision !== 'string' || !revision)
      throw new OfflineError('INVALID_RECORD');
    const adapter = this.adapters[feature];
    if (!adapter || !adapter.validate(data)) throw new OfflineError('FEATURE_NOT_READY');
    await this.checkpoint(scope);
    return this.store.update(scope, (state) => {
      this.check(scope, state, feature, 'read');
      if (!adapter.authorizeRead(scope, data)) throw new OfflineError('ACTION_NOT_ALLOWED');
      // An online refresh must never erase offline work, including conflicts.
      if (state.changes.some((c) => c.feature === feature && c.recordId === recordId)) return false;
      const k = keyFor(feature, recordId);
      state.records[k] = {
        value: data,
        serverRevision: revision,
        localVersion: (state.records[k]?.localVersion ?? 0) + 1,
      };
      return true;
    });
  }
  async save(input: {
    feature: OfflineFeature;
    recordId: string;
    kind: 'create' | 'update';
    value: RecordValue;
    expectedLocalVersion: number;
  }): Promise<{ saved: 'device'; localVersion: number; operationId: string }> {
    const { feature, recordId, kind } = input;
    const scope = { ...this.context().scope };
    const value = snapshot(input.value);
    if (!validId(recordId) || !['create', 'update'].includes(kind))
      throw new OfflineError('INVALID_RECORD');
    const adapter = this.adapters[feature];
    if (!adapter || !adapter.validate(value)) throw new OfflineError('FEATURE_NOT_READY');
    await this.checkpoint(scope);
    return this.store.update(scope, (state) => {
      this.check(scope, state, feature, kind);
      const key = keyFor(feature, recordId);
      const previous = state.records[key] ?? null;
      if ((previous?.localVersion ?? 0) !== input.expectedLocalVersion)
        throw new OfflineError('LOCAL_CONFLICT');
      const related = state.changes.filter((c) => c.feature === feature && c.recordId === recordId);
      const existing = related.at(-1);
      if (related.some((change) => change.state === 'conflict' || change.state === 'blocked'))
        throw new OfflineError('RECONCILE_FIRST');
      const followsAttempt = !!existing && (existing.attempts > 0 || existing.state === 'sending');
      if (
        !existing &&
        ((kind === 'create' && previous) || (kind === 'update' && !previous?.serverRevision))
      ) {
        throw new OfflineError('INVALID_BASE');
      }
      if (!adapter.authorize(scope, kind, value, previous))
        throw new OfflineError('ACTION_NOT_ALLOWED');
      const localVersion = (previous?.localVersion ?? 0) + 1;
      const operationId = this.newId();
      if (!validId(operationId) || state.changes.some((c) => c.id === operationId))
        throw new OfflineError('INVALID_OPERATION_ID');
      const change: PendingChange = {
        id: operationId,
        feature,
        recordId,
        kind: followsAttempt ? 'update' : (existing?.kind ?? kind),
        ...(followsAttempt
          ? { afterId: existing!.id }
          : existing?.afterId
            ? { afterId: existing.afterId }
            : {}),
        value,
        baseRevision: existing?.baseRevision ?? previous?.serverRevision ?? null,
        localVersion,
        state: 'pending',
        attempts: 0,
        claim: null,
        claimUntil: 0,
      };
      if (existing && !followsAttempt)
        state.changes.splice(state.changes.indexOf(existing), 1, change);
      else state.changes.push(change);
      state.records[key] = { value, serverRevision: change.baseRevision, localVersion };
      // The store resolves only after the durable transaction completes.
      return { saved: 'device', localVersion, operationId };
    });
  }
  /** Explicit keep-both choice. Never updates the conflicting online record. */
  async forkConflict(operationId: string, recordId: string, value: RecordValue): Promise<void> {
    const scope = { ...this.context().scope };
    const safe = snapshot(value);
    await this.checkpoint(scope);
    await this.store.update(scope, (state) => {
      const original = state.changes.find((change) => change.id === operationId);
      if (!original || original.state !== 'conflict') throw new OfflineError('CONFLICT_CHANGED');
      this.check(scope, state, original.feature, 'create');
      const adapter = this.adapters[original.feature];
      if (
        !validId(recordId) ||
        state.records[keyFor(original.feature, recordId)] ||
        !adapter?.validate(safe) ||
        !adapter.authorize(scope, 'create', safe, null)
      )
        throw new OfflineError('ACTION_NOT_ALLOWED');
      const id = this.newId();
      if (!validId(id) || state.changes.some((change) => change.id === id))
        throw new OfflineError('INVALID_OPERATION_ID');
      const replacement: PendingChange = {
        id,
        feature: original.feature,
        recordId,
        kind: 'create',
        value: safe,
        baseRevision: null,
        localVersion: 1,
        state: 'pending',
        attempts: 0,
        claim: null,
        claimUntil: 0,
      };
      // Replacement and removal commit together; a storage failure keeps the original.
      const dependents = state.changes.filter((change) => change.afterId === original.id);
      if (dependents.some((change) => change.attempts > 0))
        throw new OfflineError('CONFLICT_CHANGED');
      state.changes = state.changes.filter(
        (change) => change.id !== original.id && change.afterId !== original.id
      );
      state.changes.push(replacement);
      state.records[keyFor(original.feature, recordId)] = {
        value: safe,
        serverRevision: null,
        localVersion: 1,
      };
    });
  }
  async sync(transport: OfflineTransport): Promise<{ synced: number; stopped: string | null }> {
    const scope = { ...this.context().scope };
    scopeKey(scope);
    if (transport.protocol !== 'offline-mutation-v1')
      throw new OfflineError('UNSAFE_SYNC_PROTOCOL');
    this.bound(scope);
    // A connected browser, cached permit or old role is never proof of current access.
    if (!(await transport.revalidate(scope)))
      return { synced: 0, stopped: 'ACCESS_RECHECK_FAILED' };
    this.bound(scope);
    let synced = 0;
    const batch = (await this.store.read(scope)).changes.map((c) => c.id);
    for (const id of batch) {
      this.bound(scope);
      const claimId = this.newId();
      const operation = await this.store.update(scope, (state) => {
        const c = this.bound(scope);
        const change = state.changes.find((item) => item.id === id);
        if (!change || change.afterId || change.state === 'conflict' || change.state === 'blocked')
          return null;
        if (change.state === 'sending' && change.claimUntil > c.nowMs) return null;
        const adapter = this.adapters[change.feature];
        if (
          !adapter ||
          !adapter.validate(change.value) ||
          !adapter.authorize(
            scope,
            change.kind,
            change.value,
            state.records[keyFor(change.feature, change.recordId)] ?? null
          )
        ) {
          change.state = 'blocked';
          return null;
        }
        change.state = 'sending';
        change.claim = claimId;
        change.claimUntil = c.nowMs + 60_000;
        change.attempts += 1;
        return structuredClone(change);
      });
      if (!operation) continue;
      let result: SyncResult;
      try {
        this.bound(scope);
        result = await transport.apply(scope, {
          id: operation.id,
          feature: operation.feature,
          recordId: operation.recordId,
          kind: operation.kind,
          value: structuredClone(operation.value),
          baseRevision: operation.baseRevision,
        });
      } catch {
        result = { status: 'retry' };
      }
      // Acknowledgements go only to the original partition, even after sign-out.
      const outcome = await this.store.update(scope, (state) => {
        const change = state.changes.find((c) => c.id === id);
        if (!change || change.claim !== claimId) return 'CLAIM_CHANGED';
        const adapter = this.adapters[change.feature];
        let acceptedValue: RecordValue | null = null;
        if (
          result?.status === 'applied' &&
          result.operationId === id &&
          result.recordId === change.recordId &&
          typeof result.revision === 'string' &&
          result.revision
        ) {
          try {
            const data = snapshot(result.value);
            if (adapter?.validate(data) && adapter.authorizeRead(scope, data)) acceptedValue = data;
          } catch {
            /* Malformed acknowledgement is not success. Keep the same id. */
          }
        }
        if (acceptedValue && result.status === 'applied') {
          const dependent = state.changes.find((item) => item.afterId === id);
          if (dependent) {
            // Apply only the newer device edits to the confirmed row. If another
            // device changed one of those fields, retain the draft for review.
            const merged = structuredClone(acceptedValue);
            let conflict = false;
            for (const key of new Set([
              ...Object.keys(change.value),
              ...Object.keys(dependent.value),
            ])) {
              if (adapter?.serverFields?.includes(key)) continue;
              const before = JSON.stringify(change.value[key]),
                next = JSON.stringify(dependent.value[key]);
              if (before === next) continue;
              const online = JSON.stringify(acceptedValue[key]);
              if (online !== before && online !== next) conflict = true;
              if (key in dependent.value) merged[key] = dependent.value[key];
              else delete merged[key];
            }
            delete dependent.afterId;
            dependent.baseRevision = result.revision;
            dependent.localVersion++;
            if (
              !adapter?.validate(merged) ||
              !adapter.authorize(scope, 'update', merged, {
                value: acceptedValue,
                serverRevision: result.revision,
                localVersion: change.localVersion,
              })
            )
              conflict = true;
            dependent.value = conflict ? dependent.value : merged;
            dependent.state = conflict ? 'conflict' : 'pending';
            state.records[keyFor(change.feature, change.recordId)] = {
              value: structuredClone(dependent.value),
              serverRevision: result.revision,
              localVersion: dependent.localVersion,
            };
          } else {
            state.records[keyFor(change.feature, change.recordId)] = {
              value: acceptedValue,
              serverRevision: result.revision,
              localVersion: change.localVersion + 1,
            };
          }
          state.changes = state.changes.filter((c) => c.id !== id);
          return 'APPLIED';
        }
        change.claim = null;
        change.claimUntil = 0;
        change.state =
          result?.status === 'conflict'
            ? 'conflict'
            : result?.status === 'forbidden'
              ? 'blocked'
              : 'pending';
        return change.state === 'conflict'
          ? 'CONFLICT'
          : change.state === 'blocked'
            ? 'ACCESS_DENIED'
            : 'RETRY_LATER';
      });
      if (outcome === 'APPLIED') synced += 1;
      else return { synced, stopped: outcome };
    }
    const remaining = (await this.store.read(scope)).changes;
    const stopped = remaining.some((c) => c.state === 'blocked')
      ? 'ACCESS_DENIED'
      : remaining.some((c) => c.state === 'conflict')
        ? 'CONFLICT'
        : remaining.length
          ? 'PENDING_CHANGES'
          : null;
    return { synced, stopped };
  }
}
