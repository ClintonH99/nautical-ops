import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const STORAGE_PREFIX = 'nautical_ops:fuel_request:v1:';

interface StoredFuelRequest {
  id: string;
  fingerprint: string;
  createdAt: number;
  /**
   * Written before best-effort cleanup once the server acknowledges a write.
   * If removeItem fails, this tombstone prevents the next identical action
   * from replaying an already completed logical request.
   */
  acknowledgedAt?: number;
}

export interface PendingFuelRequest {
  id: string;
  storageKey: string;
}

const runtimePending = new Map<string, StoredFuelRequest>();
const keyLocks = new Map<string, Promise<void>>();
const SAFE_PREPARATION_ERROR =
  'Nautical Ops could not safely prepare this fuel record. No data was sent. Please free device storage or restart the app, then try again.';

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? '"__undefined__"' : encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function isStoredFuelRequest(value: unknown): value is StoredFuelRequest {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<StoredFuelRequest>;
  return (
    typeof row.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id) &&
    typeof row.fingerprint === 'string' &&
    typeof row.createdAt === 'number' &&
    Number.isFinite(row.createdAt) &&
    (row.acknowledgedAt === undefined ||
      (typeof row.acknowledgedAt === 'number' && Number.isFinite(row.acknowledgedAt)))
  );
}

async function withKeyLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = keyLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  keyLocks.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (keyLocks.get(key) === current) keyLocks.delete(key);
  }
}

async function payloadFingerprint(payload: unknown): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, canonicalJson(payload));
}

async function fuelRequestIdentity(
  scope: string,
  payload: unknown
): Promise<{ fingerprint: string; storageKey: string }> {
  const normalizedScope = scope.trim();
  if (!normalizedScope) throw new Error('A fuel request scope is required.');
  const fingerprint = await payloadFingerprint(payload);
  return {
    fingerprint,
    storageKey: `${STORAGE_PREFIX}${normalizedScope}:${fingerprint}`,
  };
}

/** Stable key used to single-flight one logical request before storage acquisition. */
export async function getFuelRequestStorageKey(scope: string, payload: unknown): Promise<string> {
  return (await fuelRequestIdentity(scope, payload)).storageKey;
}

/**
 * Returns one request UUID for one logical, retryable fuel write. The pending
 * key is persisted before the network call, so an app restart after an
 * uncertain response reuses the same UUID instead of duplicating inventory.
 */
export async function acquireFuelRequest(
  scope: string,
  payload: unknown,
  preferredId?: string
): Promise<PendingFuelRequest> {
  const { fingerprint, storageKey } = await fuelRequestIdentity(scope, payload);
  // Keep uncertain writes by payload, not just by form/action. If a user edits
  // a form and later restores its original values, the original unresolved
  // request must still replay instead of creating a duplicate operation.
  return withKeyLock(storageKey, async () => {
    let stored = runtimePending.get(storageKey) ?? null;
    if (!stored) {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (!isStoredFuelRequest(parsed)) {
            throw new Error('Stored fuel request is invalid.');
          }
          stored = parsed;
        }
      } catch (error) {
        console.warn('Could not read pending fuel request:', error);
        // An unreadable value may be an unresolved request from an uncertain
        // prior response. Replacing it with a fresh UUID could double-post the
        // same inventory event, so no network call is allowed to follow.
        throw new Error(SAFE_PREPARATION_ERROR);
      }
    }

    if (stored?.acknowledgedAt !== undefined) {
      // The server completed this request, but an earlier cleanup may have
      // failed. Never reuse the acknowledged UUID for a new user action.
      try {
        await AsyncStorage.removeItem(storageKey);
      } catch (error) {
        console.warn('Could not clear acknowledged fuel request:', error);
      }
      runtimePending.delete(storageKey);
      stored = null;
    }

    if (stored && stored.fingerprint === fingerprint) {
      runtimePending.set(storageKey, stored);
      return { id: stored.id, storageKey };
    }

    const next: StoredFuelRequest = {
      id: preferredId?.trim() || Crypto.randomUUID(),
      fingerprint,
      createdAt: Date.now(),
    };
    if (!isStoredFuelRequest(next)) throw new Error('Fuel request ID must be a valid UUID.');
    runtimePending.set(storageKey, next);
    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify(next));
    } catch (error) {
      console.warn('Could not persist pending fuel request:', error);
      runtimePending.delete(storageKey);
      throw new Error(SAFE_PREPARATION_ERROR);
    }
    return { id: next.id, storageKey };
  });
}

/** Clear only the exact request that the server has acknowledged. */
export async function completeFuelRequest(request: PendingFuelRequest): Promise<void> {
  await withKeyLock(request.storageKey, async () => {
    let current = runtimePending.get(request.storageKey) ?? null;
    if (current && current.id !== request.id) return;

    if (!current) {
      try {
        const raw = await AsyncStorage.getItem(request.storageKey);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (isStoredFuelRequest(parsed)) {
            if (parsed.id !== request.id) return;
            current = parsed;
          }
        }
      } catch (error) {
        console.warn('Could not verify pending fuel request:', error);
        return;
      }
    }

    if (!current) return;

    const acknowledged: StoredFuelRequest = {
      ...current,
      acknowledgedAt: current.acknowledgedAt ?? Date.now(),
    };
    runtimePending.set(request.storageKey, acknowledged);
    try {
      await AsyncStorage.setItem(request.storageKey, JSON.stringify(acknowledged));
    } catch (error) {
      // Keep the in-memory tombstone. The successful server response remains
      // authoritative, so surfacing a false write failure would invite a
      // duplicate manual retry in this session.
      console.warn('Could not mark fuel request as acknowledged:', error);
    }

    try {
      await AsyncStorage.removeItem(request.storageKey);
      runtimePending.delete(request.storageKey);
    } catch (error) {
      console.warn('Could not clear pending fuel request:', error);
    }
  });
}

export const __fuelRequestTesting = {
  reset(): void {
    runtimePending.clear();
    keyLocks.clear();
  },
};
