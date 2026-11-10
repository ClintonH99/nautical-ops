import { OfflineError, scopeKey } from './access.ts';
import type { OfflineScope } from './access.ts';
import { emptyPartition } from './outbox.ts';
import type { OfflineStore, Partition } from './outbox.ts';
import type { PendingChange } from './outbox.ts';
import { recoveryCount, planRecovery } from './recovery.ts';
export type BrowserOfflineStore = OfflineStore & {
  close(): void;
  recoverable(scope: OfflineScope): Promise<number>;
  recover(scope: OfflineScope, allowed: (change: PendingChange) => boolean): Promise<number>;
};

/** No auth tokens, passwords or API keys belong in this database. */
export async function openOfflineStore(
  name = 'nautical-ops-offline-v1'
): Promise<BrowserOfflineStore> {
  if (!globalThis.indexedDB) throw new OfflineError('LOCAL_STORAGE_UNAVAILABLE');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('partitions'))
        request.result.createObjectStore('partitions');
    };
    request.onerror = () => reject(new OfflineError('LOCAL_STORAGE_UNAVAILABLE'));
    request.onblocked = () => {
      blocked = true;
      reject(new OfflineError('CLOSE_OTHER_TABS'));
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
  function transaction<T>(
    scope: OfflineScope,
    write: boolean,
    change: (state: Partition) => T
  ): Promise<T> {
    const key = scopeKey(scope);
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction('partitions', write ? 'readwrite' : 'readonly');
      } catch {
        reject(new OfflineError('LOCAL_STORAGE_UNAVAILABLE'));
        return;
      }
      let result: T;
      let failure: unknown;
      tx.onabort = () => reject(failure ?? new OfflineError('LOCAL_SAVE_FAILED'));
      tx.onerror = () => {
        /* onabort supplies the final result; never report success early. */
      };
      tx.oncomplete = () => resolve(result);
      const store = tx.objectStore('partitions');
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const state = (request.result ?? emptyPartition()) as Partition;
          if (state.schema !== 1 || !state.records || !Array.isArray(state.changes))
            throw new OfflineError('LOCAL_DATA_NEEDS_REVIEW');
          result = change(state);
          if (result instanceof Promise) throw new OfflineError('ASYNC_LOCAL_TRANSACTION');
          if (write) store.put(state, key);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  }
  function recovery(
    scope: OfflineScope,
    allowed?: (change: PendingChange) => boolean
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction('partitions', allowed ? 'readwrite' : 'readonly');
      } catch {
        reject(new OfflineError('LOCAL_STORAGE_UNAVAILABLE'));
        return;
      }
      let result = 0,
        failure: unknown;
      tx.onabort = () => reject(failure ?? new OfflineError('LOCAL_SAVE_FAILED'));
      tx.onerror = () => {};
      tx.oncomplete = () => resolve(result);
      const store = tx.objectStore('partitions'),
        keys = store.getAllKeys(),
        values = store.getAll();
      values.onsuccess = () => {
        try {
          const entries = keys.result.map(
            (key, index) => [key, values.result[index]] as [string, Partition]
          );
          if (allowed) {
            const plan = planRecovery(entries, scope, allowed);
            result = plan.moved;
            for (const [key, value] of plan.updates) store.put(value, key);
          } else result = recoveryCount(entries, scope);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  }
  return {
    read: (scope) => transaction(scope, false, (state) => state),
    update: (scope, change) => transaction(scope, true, change),
    recoverable: (scope) => recovery(scope),
    recover: (scope, allowed) => recovery(scope, allowed),
    close: () => db.close(),
  };
}
