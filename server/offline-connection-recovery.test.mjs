import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { OfflineError } from "../yachy-app/src/offline/access.ts";
import { isOfflineConnectionFailure } from "../yachy-app/src/offline/connectionFailure.ts";
const require = createRequire(
  new URL("../yachy-app/package.json", import.meta.url),
);
const ts = require("typescript");
const code = ts.transpileModule(
  readFileSync(
    new URL("../yachy-app/src/offline/runtime.web.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
function create(init) {
  let state = init();
  return {
    getState: () => state,
    setState: (patch) => {
      state = {
        ...state,
        ...(typeof patch === "function" ? patch(state) : patch),
      };
    },
  };
}
function fixture() {
  const user = { id: "u1", vesselId: "v1" };
  const auth = create(() => ({
    user,
    captainPaymentRequired: false,
    crewPaymentRequired: false,
  }));
  const lease = create(() => ({ userId: "u1", status: "allowed" }));
  const navigator = { onLine: true };
  const state = {
    changes: [
      {
        id: "pending-1",
        feature: "notes",
        value: { text: "Keep this unsynced work" },
      },
    ],
    records: { note: { text: "Saved work" } },
    highestObservedMs: 0,
    recoveryCopies: [],
  };
  const saved = () =>
    JSON.stringify({ changes: state.changes, records: state.records });
  const permit = {
    claims: {
      exp: Date.now() / 1000 + 600,
      permissions: { notes: ["read", "create", "update"] },
    },
  };
  const storage = new Map([
    [
      "auth",
      JSON.stringify({
        user: { id: "u1" },
        access_token: "x." + btoa(JSON.stringify({ session_id: "s1" })) + ".x",
      }),
    ],
  ]);
  let responseStatus = 403,
    fetchError = null,
    downloadError = null,
    requests = 0;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    navigator,
    location: { origin: "https://test.example" },
    URL,
    Date,
    JSON,
    atob,
    setTimeout,
    clearTimeout,
    AbortSignal,
    console,
    process: {
      env: {
        EXPO_PUBLIC_WEB_OFFLINE: "true",
        EXPO_PUBLIC_WEB_OFFLINE_KEYS: "{}",
      },
    },
    localStorage: {
      getItem: (k) => storage.get(k),
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
    fetch: async () => {
      requests++;
      if (fetchError) throw fetchError;
      return {
        status: responseStatus,
        ok: responseStatus === 200,
        json: async () => ({ token: "verified-test-grant" }),
      };
    },
    require(name) {
      if (name === "zustand") return { create };
      if (name === "../store") return { useAuthStore: auth };
      if (name === "../services/browserSessionLease")
        return { useBrowserSessionLease: lease };
      if (name === "../services/supabase")
        return {
          SUPABASE_URL: "https://project.example",
          SUPABASE_ANON_KEY: "public",
          SUPABASE_AUTH_STORAGE_KEY: "auth",
          supabase: {
            auth: {
              getSession: async () => ({
                data: { session: { access_token: "test" } },
              }),
            },
          },
        };
      if (name === "../services/deviceAccess")
        return {
          getCurrentDeviceFingerprint: async () => "device",
          registerCurrentDevice: async () => ({ state: "allowed" }),
        };
      if (name === "./access")
        return {
          OfflineError,
          scopeKey: JSON.stringify,
          verifyOfflinePermit: async () => permit,
          requireOfflineAccess: (c) => {
            if (!c.permit || c.blocked)
              throw new OfflineError("ACCESS_BLOCKED");
          },
        };
      if (name === "./indexedDb.web")
        return {
          openOfflineStore: async () => ({
            read: async () => state,
            update: async (_s, fn) => fn(state),
            recoverable: async () => 0,
            close() {},
          }),
        };
      if (name === "./outbox")
        return {
          OfflineOutbox: class {
            async sync() {
              return { stopped: "RETRY" };
            }
          },
        };
      if (name === "./readiness")
        return {
          isOfflineStorageFailure: () => false,
          offlineRecordsReady: () => true,
        };
      if (name === "./connectionFailure") return { isOfflineConnectionFailure };
      if (name === "./boundedCheck") return { boundedCheck: async (p) => p };
      if (name === "./boundedTasks")
        return {
          runBoundedTasks: async () => {
            if (downloadError) throw downloadError;
          },
        };
      if (name === "./mediaCache.web")
        return { downloadOfflineImage: async () => null };
      return new Proxy({}, { get: () => () => ({}) });
    },
  });
  return {
    api: exports,
    auth,
    navigator,
    saved,
    requests: () => requests,
    status: (s) => {
      responseStatus = s;
    },
    networkError: (e) => {
      fetchError = e;
    },
    downloadError: (e) => {
      downloadError = e;
    },
  };
}
test("403 from offline verification is not a disconnection; retry renews the denied grant without erasing pending records", async () => {
  const f = fixture(),
    original = f.saved();
  await f.api.prepareOffline(f.auth.getState().user);
  assert.equal(f.api.useOfflineStatus.getState().disconnected, false);
  assert.equal(f.api.useOfflineStatus.getState().ready, false);
  assert.equal(f.saved(), original);
  f.status(200);
  await f.api.retryOfflineAccess();
  assert.equal(f.requests(), 2);
  assert.equal(f.api.useOfflineStatus.getState().ready, true);
  assert.equal(f.saved(), original);
});
test("a pending payment gate cannot be mistaken for a connection failure or bypassed by retry", async () => {
  const f = fixture(),
    original = f.saved();
  f.auth.setState({ captainPaymentRequired: true });
  await f.api.prepareOffline(f.auth.getState().user);
  await f.api.retryOfflineAccess();
  assert.equal(f.api.useOfflineStatus.getState().disconnected, false);
  assert.equal(f.api.useOfflineStatus.getState().ready, false);
  assert.equal(f.requests(), 0);
  assert.equal(f.saved(), original);
});
test("unreachable internet still enables safe offline behavior, then reconnects in the same partition", async () => {
  const f = fixture(),
    original = f.saved();
  f.networkError(new TypeError("Failed to fetch"));
  await f.api.prepareOffline(f.auth.getState().user);
  assert.equal(f.api.useOfflineStatus.getState().disconnected, true);
  f.networkError(null);
  f.status(200);
  await f.api.retryOfflineAccess();
  assert.equal(f.api.useOfflineStatus.getState().disconnected, false);
  assert.equal(f.api.useOfflineStatus.getState().ready, true);
  assert.equal(f.saved(), original);
});
test("a section download error does not turn verified access into an offline login lock", async () => {
  const f = fixture(),
    original = f.saved();
  f.status(200);
  f.downloadError(new OfflineError("INVALID_SNAPSHOT"));
  await f.api.prepareOffline(f.auth.getState().user);
  assert.equal(f.api.useOfflineStatus.getState().disconnected, false);
  assert.equal(f.api.useOfflineStatus.getState().ready, true);
  assert.equal(f.saved(), original);
});
test("failure classification distinguishes physical offline/timeout/network from access and storage errors", () => {
  for (const error of [
    new TypeError("Failed to fetch"),
    new TypeError("Load failed"),
    new DOMException("timeout", "TimeoutError"),
    new Error("ONLINE_CHECK_UNAVAILABLE"),
  ])
    assert.equal(isOfflineConnectionFailure(error, true), true);
  for (const error of [
    new OfflineError("ACCESS_BLOCKED"),
    new OfflineError("SCOPE_CHANGED"),
    new OfflineError("ONLINE_CHECK_UNAVAILABLE"),
    new Error("disk full"),
    new TypeError("bad local field"),
  ])
    assert.equal(isOfflineConnectionFailure(error, true), false);
  assert.equal(isOfflineConnectionFailure(null, false), true);
});
