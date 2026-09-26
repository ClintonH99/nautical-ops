import type { Department } from '../types';
import type { InventoryItem, InventoryItemRow } from '../services/inventory';

export interface InventoryValues {
  department: Department;
  title: string;
  location: string;
  description: string;
  items: InventoryItemRow[];
}
export interface InventoryPendingItem {
  id: string;
  values: InventoryValues;
  base: InventoryItem | null;
  version: number;
  savedVersion: number;
  // Persist the exact in-flight operation so an uncertain create can be retried safely.
  attempt?: { values: InventoryValues; version: number; base: InventoryItem | null };
  blocked?: boolean;
  error?: string;
  saving?: boolean;
  localSaved?: boolean;
  deleting?: boolean;
}
export interface InventoryAutoSaveState {
  ready: boolean;
  enabled: boolean;
  newItemId?: string;
  entries: Record<string, InventoryPendingItem>;
  storageError?: string;
}
interface Dependencies {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  canSync: () => boolean;
  save: (
    entry: InventoryPendingItem,
    attempt: NonNullable<InventoryPendingItem['attempt']>
  ) => Promise<InventoryItem>;
}

/** Inventory-only durable write queue. One writer per item; latest typing never loses to an older response. */
export class InventoryAutoSaveQueue {
  private state: InventoryAutoSaveState = { ready: false, enabled: true, entries: {} };
  private listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private loading?: Promise<void>;
  private running = new Map<string, Promise<void>>();
  private paused = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private deps: Dependencies) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<InventoryAutoSaveState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private setEntry(entry: InventoryPendingItem) {
    this.publish({ entries: { ...this.state.entries, [entry.id]: entry } });
  }
  private persist() {
    const payload = JSON.stringify({
      ...this.state,
      storageError: undefined,
      entries: Object.fromEntries(
        Object.entries(this.state.entries).map(([id, entry]) => [id, { ...entry, saving: false }])
      ),
    });
    const operation = this.writes.catch(() => {}).then(() => this.deps.write(payload));
    this.writes = operation;
    return operation;
  }
  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const raw = await this.deps.read();
        const saved = raw ? JSON.parse(raw) : null;
        if (
          saved &&
          typeof saved.enabled === 'boolean' &&
          saved.entries &&
          typeof saved.entries === 'object'
        ) {
          this.publish({
            enabled: saved.enabled,
            newItemId: saved.entries[saved.newItemId]?.deleting ? undefined : saved.newItemId,
            entries: Object.fromEntries(
              Object.entries(saved.entries as Record<string, InventoryPendingItem>)
                .filter(
                  ([id, entry]) =>
                    entry?.id === id &&
                    entry.values &&
                    typeof entry.values.title === 'string' &&
                    typeof entry.values.location === 'string' &&
                    typeof entry.values.description === 'string' &&
                    Number.isFinite(entry.version) &&
                    Number.isFinite(entry.savedVersion) &&
                    Array.isArray(entry.values.items)
                )
                .map(([id, entry]) => [id, { ...entry, saving: false, localSaved: true }])
            ),
          });
        }
        this.publish({ ready: true, storageError: undefined });
      } catch {
        this.loading = undefined;
        this.publish({ storageError: 'Could not read saved changes. Please try again.' });
      }
    })();
    return this.loading;
  }
  open(id: string, values: InventoryValues, base: InventoryItem | null, isNew = false) {
    const existing = this.state.entries[id];
    if (
      !existing ||
      existing.deleting ||
      (existing.version === existing.savedVersion && !existing.attempt)
    ) {
      this.setEntry({ id, values, base, version: 0, savedVersion: 0, localSaved: true });
    }
    if (isNew) this.publish({ newItemId: id });
    return this.state.entries[id];
  }
  change(id: string, values: InventoryValues) {
    const entry = this.state.entries[id];
    if (!entry || this.paused.has(id)) return;
    const version = entry.version + 1;
    this.setEntry({
      ...entry,
      values,
      version,
      localSaved: false,
      error: entry.blocked ? entry.error : undefined,
    });
    void this.persist()
      .then(() => {
        const latest = this.state.entries[id];
        if (latest?.version === version) this.setEntry({ ...latest, localSaved: true });
        this.publish({ storageError: undefined });
      })
      .catch(() =>
        this.publish({ storageError: 'Device save failed. Keep this page open and retry.' })
      );
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, 650);
  }
  async setEnabled(enabled: boolean) {
    this.publish({ enabled });
    try {
      await this.persist();
    } catch {
      this.publish({ storageError: 'Could not remember your Auto Save setting.' });
    }
    if (enabled) void this.flush();
  }
  async leave(id: string) {
    // Keep untitled work available from Create Inventory Item; titled work is available from the list.
    if (this.state.newItemId === id && this.state.entries[id]?.values.title.trim()) {
      this.publish({ newItemId: undefined });
    }
    try {
      await this.persist();
    } catch {
      this.publish({ storageError: 'Device save failed. Keep this page open and retry.' });
    }
    await this.flush();
  }
  async flush() {
    if (!this.state.ready || !this.state.enabled || !this.deps.canSync()) return;
    if (this.state.storageError) {
      try {
        await this.persist();
        this.publish({ storageError: undefined });
      } catch {
        return;
      }
    }
    await Promise.all(Object.keys(this.state.entries).map((id) => this.save(id).catch(() => {})));
  }
  async save(id: string, manual = false): Promise<void> {
    const pending = this.running.get(id);
    if (pending) {
      await pending;
      return this.save(id, manual);
    }
    const entry = this.state.entries[id];
    if (
      !entry ||
      entry.deleting ||
      this.paused.has(id) ||
      !this.deps.canSync() ||
      (!manual && !this.state.enabled)
    )
      return;
    if (entry.blocked) {
      if (manual) throw new Error(entry.error);
      return;
    }
    if (entry.savedVersion === entry.version && !entry.attempt) return;
    if (!entry.values.title.trim() && !entry.attempt) {
      if (manual)
        throw new Error('Please enter a title. Your other changes are kept on this device.');
      return;
    }
    const operation = this.performSave(id, manual);
    this.running.set(id, operation);
    try {
      await operation;
    } finally {
      if (this.running.get(id) === operation) this.running.delete(id);
    }
  }
  private async performSave(id: string, manual: boolean) {
    while (this.deps.canSync() && !this.paused.has(id) && (manual || this.state.enabled)) {
      const entry = this.state.entries[id];
      if (!entry || entry.blocked || (entry.version === entry.savedVersion && !entry.attempt))
        return;
      if (!entry.values.title.trim() && !entry.attempt) return;
      const attempt = entry.attempt ?? {
        values: entry.values,
        version: entry.version,
        base: entry.base,
      };
      this.setEntry({ ...entry, attempt, saving: true, error: undefined });
      try {
        await this.persist(); // Durable operation identity BEFORE network writes.
        if (!this.deps.canSync() || this.paused.has(id) || (!manual && !this.state.enabled)) {
          this.setEntry({ ...this.state.entries[id], saving: false });
          return;
        }
        const saved = await this.deps.save(entry, attempt);
        this.setEntry({
          ...this.state.entries[id],
          base: saved,
          savedVersion: attempt.version,
          attempt: undefined,
          saving: false,
          localSaved: true,
        });
        try {
          await this.persist();
          this.publish({ storageError: undefined });
        } catch {
          this.publish({ storageError: 'Device save failed. Keep this page open and retry.' });
        }
      } catch (error) {
        const conflict = error instanceof Error && error.name === 'InventoryConflictError';
        this.setEntry({
          ...this.state.entries[id],
          saving: false,
          blocked: conflict,
          error: conflict
            ? 'Changed elsewhere. Tap to review.'
            : 'Not synced. Retrying when connected.',
        });
        // The pre-request snapshot remains available even if this write fails.
        try {
          await this.persist();
        } catch {
          this.publish({ storageError: 'Device save failed. Keep this page open and retry.' });
        }
        throw error;
      }
    }
  }
  async resolve(id: string, latest: InventoryItem, keepLocal: boolean) {
    const entry = this.state.entries[id];
    if (!entry) return;
    this.setEntry({
      ...entry,
      base: latest,
      values: keepLocal ? entry.values : latest,
      version: entry.version + 1,
      savedVersion: keepLocal ? entry.savedVersion : entry.version + 1,
      attempt: undefined,
      error: undefined,
      blocked: false,
    });
    await this.persist();
    if (keepLocal) await this.save(id, true);
  }
  async delete(id: string, remove: (created: boolean) => Promise<void>) {
    this.paused.add(id);
    try {
      await this.running.get(id)?.catch(() => {});
      const entry = this.state.entries[id];
      if (entry) {
        this.setEntry({ ...entry, deleting: true });
        await this.persist(); // A killed app must never replay writes for a deleted item.
      }
      // An uncertain create may have reached the server, so use its stable ID.
      await remove(!entry || !!entry.base || !!entry.attempt);
      const entries = { ...this.state.entries };
      delete entries[id];
      this.publish({
        entries,
        newItemId: this.state.newItemId === id ? undefined : this.state.newItemId,
      });
      try {
        await this.persist();
      } catch {
        this.publish({
          storageError: 'Could not clear the local copy. It will not be synced again.',
        });
      }
    } catch (error) {
      const entry = this.state.entries[id];
      if (entry) {
        this.setEntry({ ...entry, deleting: false });
        try {
          await this.persist();
        } catch {
          /* Earlier durable tombstone remains safe. */
        }
      }
      throw error;
    } finally {
      this.paused.delete(id);
    }
  }
}
