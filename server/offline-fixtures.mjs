import {
  verifyOfflinePermit,
  scopeKey,
} from "../yachy-app/src/offline/access.ts";
import {
  emptyPartition,
  OfflineOutbox,
} from "../yachy-app/src/offline/outbox.ts";

export const epoch = Date.UTC(2026, 10, 9, 12);
export const day = 86_400_000;
export const scope = Object.freeze({
  origin: "https://offline.example.test",
  projectId: "test-project",
  userId: "test-user",
  vesselId: "test-vessel",
  deviceId: "test-device",
  sessionId: "test-session",
});
export const claims = {
  iss: `nautical-ops:${scope.projectId}`,
  aud: scope.origin,
  sub: scope.userId,
  projectId: scope.projectId,
  vesselId: scope.vesselId,
  deviceId: scope.deviceId,
  sessionId: scope.sessionId,
  iat: epoch / 1000,
  exp: (epoch + 7 * day) / 1000,
  accessUntil: (epoch + 30 * day) / 1000,
  permissions: { notes: ["read", "create", "update"] },
};
// Ephemeral synthetic test keys only; never saved and never accepted by any server.
const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
export const trustedKeys = {
  test: await crypto.subtle.exportKey("jwk", pair.publicKey),
};
const b64 = (x) => Buffer.from(x).toString("base64url");
export async function signedToken(overrides = {}, header = {}) {
  const input = `${b64(JSON.stringify({ alg: "ES256", typ: "nautical-ops-offline+jwt", kid: "test", ...header }))}.${b64(JSON.stringify({ ...claims, ...overrides }))}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${b64(new Uint8Array(signature))}`;
}
export async function permit(overrides = {}) {
  return verifyOfflinePermit(await signedToken(overrides), trustedKeys, scope);
}
export class MemoryStore {
  partitions = new Map();
  tails = new Map();
  failWrites = false;
  async read(scope) {
    return structuredClone(
      this.partitions.get(scopeKey(scope)) ?? emptyPartition(),
    );
  }
  async update(scope, change) {
    const key = scopeKey(scope);
    const next = (this.tails.get(key) ?? Promise.resolve()).then(() => {
      if (this.failWrites) throw Error("test quota failure");
      const state = structuredClone(
        this.partitions.get(key) ?? emptyPartition(),
      );
      const result = change(state);
      this.partitions.set(key, structuredClone(state));
      return result;
    });
    this.tails.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }
}
export const notesAdapter = {
  authorizeRead: (scope, v) => v.ownerId === scope.userId,
  validate: (v) =>
    typeof v.title === "string" &&
    typeof v.content === "string" &&
    typeof v.ownerId === "string" &&
    Object.keys(v).every((k) => ["title", "content", "ownerId"].includes(k)),
  authorize: (scope, _kind, value, previous) =>
    value.ownerId === scope.userId &&
    (!previous || previous.value.ownerId === scope.userId),
};
export const note = {
  ownerId: scope.userId,
  title: "Offline note",
  content: "Synthetic data only",
};
export async function fixture(overrides = {}, adapter = notesAdapter) {
  const store = new MemoryStore();
  const context = {
    scope: { ...scope },
    permit: await permit(),
    nowMs: epoch,
    highestObservedMs: epoch,
    blocked: false,
    ...overrides,
  };
  let counter = 0;
  const makeBox = () =>
    new OfflineOutbox({
      store,
      context: () => context,
      adapters: { notes: adapter },
      newId: () => `test-op-${++counter}`,
    });
  const box = makeBox();
  const create = (id = "note-1") =>
    box.save({
      feature: "notes",
      recordId: id,
      kind: "create",
      value: note,
      expectedLocalVersion: 0,
    });
  return { box, store, context, makeBox, create };
}
export const success = (op) => ({
  status: "applied",
  operationId: op.id,
  recordId: op.recordId,
  revision: "server-r2",
  value: op.value,
});
export const transport = (
  apply = async (_s, op) => success(op),
  revalidate = async () => true,
) => ({ protocol: "offline-mutation-v1", apply, revalidate });
