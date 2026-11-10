import test from "node:test";
import assert from "node:assert/strict";
import { createOfflineAccessHandler } from "../yachy-app/supabase/functions/_shared/offlineAccess.mjs";
import {
  OFFLINE_FEATURES,
  verifyOfflinePermit,
} from "../yachy-app/src/offline/access.ts";
const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
const scope = {
  origin: "https://www.nautical-ops.com",
  projectId: "synthetic",
  userId: "00000000-0000-0000-0000-000000000001",
  vesselId: "00000000-0000-0000-0000-000000000002",
  sessionId: "00000000-0000-0000-0000-000000000003",
  deviceId: "a".repeat(64),
};
const now = Math.floor(Date.now() / 1000);
const context = {
  ...scope,
  iat: now,
  exp: now + 604800,
  accessUntil: now + 604800,
  permissions: { notes: ["read", "create", "update"] },
};
function fixture({
  authError = null,
  rpcError = null,
  data = context,
  env = {},
} = {}) {
  let queries = 0;
  const vars = {
    SUPABASE_URL: "https://synthetic.supabase.co",
    SUPABASE_ANON_KEY: "synthetic-publishable",
    WEB_OFFLINE_ENABLED: "true",
    WEB_OFFLINE_SIGNING_KEY_ID: "test",
    WEB_OFFLINE_SIGNING_JWK: JSON.stringify(privateKey),
    ...env,
  };
  const handler = createOfflineAccessHandler({
    getEnv: (k) => vars[k],
    createClient: () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: scope.userId } },
          error: authError,
        }),
      },
      rpc: async () => {
        queries++;
        return { data, error: rpcError };
      },
    }),
  });
  const request = (changes = {}) =>
    new Request(
      "https://synthetic.supabase.co/functions/v1/web-offline-access",
      {
        method: "POST",
        headers: {
          origin: scope.origin,
          authorization: "Bearer synthetic-test-token",
          "content-type": "application/json",
          ...changes.headers,
        },
        body: JSON.stringify({
          vesselId: scope.vesselId,
          deviceId: scope.deviceId,
          ...changes.body,
        }),
      },
    );
  return { handler, request, queries: () => queries };
}
test("issued permit is verifiable and bound to exact browser/user/vessel/session", async () => {
  const f = fixture();
  const response = await f.handler(f.request());
  assert.equal(response.status, 200);
  const { token } = await response.json();
  const permit = await verifyOfflinePermit(token, { test: publicKey }, scope);
  assert.equal(permit.claims.exp - permit.claims.iat, 604800);
  assert.deepEqual(permit.claims.permissions, {
    notes: ["read", "create", "update"],
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(token.includes(privateKey.d), false);
});
test("untrusted origin rejected before any database query", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.handler(
        f.request({ headers: { origin: "https://evil.example" } }),
      )
    ).status,
    403,
  );
  assert.equal(f.queries(), 0);
});
test("permissions come from verified server context and never expand beyond implemented features", async () => {
  const f = fixture({
    data: {
      ...context,
      permissions: {
        notes: ["read"],
        shoppingLists: ["read", "update"],
        tasks: ["read", "create", "update"],
        payments: ["create"],
      },
    },
  });
  const { token } = await (await f.handler(f.request())).json();
  const permit = await verifyOfflinePermit(token, { test: publicKey }, scope);
  assert.deepEqual(permit.claims.permissions, {
    notes: ["read"],
    shoppingLists: ["read", "update"],
    tasks: ["read", "create", "update"],
  });
  const missing = fixture({ data: { ...context, permissions: null } });
  assert.equal((await missing.handler(missing.request())).status, 503);
});
test("invalid login rejected before access lookup", async () => {
  const f = fixture({ authError: { message: "denied" } });
  assert.equal((await f.handler(f.request())).status, 401);
  assert.equal(f.queries(), 0);
});
test("signed permits retain every implemented feature and its exact server permissions", async () => {
  const permissions = Object.fromEntries(
    OFFLINE_FEATURES.map((feature) => [
      feature,
      feature === "fuelAdjustments" ? ["read"] : ["read", "create", "update"],
    ]),
  );
  const f = fixture({ data: { ...context, permissions } });
  const response = await f.handler(f.request());
  assert.equal(response.status, 200);
  const { token } = await response.json();
  const permit = await verifyOfflinePermit(token, { test: publicKey }, scope);
  assert.deepEqual(permit.claims.permissions, permissions);
});
test("disabled configuration issues no permits", async () => {
  const f = fixture({ env: { WEB_OFFLINE_ENABLED: "false" } });
  assert.equal((await f.handler(f.request())).status, 503);
  assert.equal(f.queries(), 0);
});
for (const [name, change] of Object.entries({
  wrongUser: { userId: scope.vesselId },
  wrongVessel: { vesselId: scope.userId },
  wrongDevice: { deviceId: "b".repeat(64) },
  wrongSession: { sessionId: "bad" },
  tooLong: { exp: now + 604801, accessUntil: now + 700000 },
  pastExpiry: { exp: now - 1 },
  missingDeadline: { accessUntil: null },
})) {
  test(`invalid server context ${name} fails closed`, async () => {
    const f = fixture({ data: { ...context, ...change } });
    assert.equal((await f.handler(f.request())).status, 503);
  });
}
test("server permission denial is distinguished from temporary failure", async () => {
  for (const [code, status] of [
    ["42501", 403],
    ["57014", 503],
  ]) {
    const f = fixture({ rpcError: { code } });
    assert.equal((await f.handler(f.request())).status, status);
  }
});
test("oversized request and malformed identifiers rejected", async () => {
  const f = fixture();
  assert.equal(
    (await f.handler(f.request({ body: { deviceId: "x" } }))).status,
    400,
  );
  assert.equal(
    (await f.handler(f.request({ body: { padding: "x".repeat(3000) } })))
      .status,
    413,
  );
});
