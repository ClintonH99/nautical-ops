import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyOfflinePermit,
  requireOfflineAccess,
  OFFLINE_WINDOW_MS,
  scopeKey,
} from "../yachy-app/src/offline/access.ts";
import {
  claims,
  scope,
  trustedKeys,
  signedToken,
  permit,
  epoch,
  day,
} from "./offline-fixtures.mjs";

const context = async (overrides = {}) => ({
  scope,
  permit: await permit(),
  nowMs: epoch,
  highestObservedMs: epoch,
  blocked: false,
  ...overrides,
});
const denied = (code) => (e) => e.code === code;
test("exact seven-day duration", () =>
  assert.equal(OFFLINE_WINDOW_MS, 7 * day));
test("valid permit works until but not at the expiry boundary", async () => {
  const c = await context({ nowMs: epoch + 7 * day - 1 });
  assert.doesNotThrow(() => requireOfflineAccess(c, "notes", "update"));
  assert.throws(
    () =>
      requireOfflineAccess({ ...c, nowMs: epoch + 7 * day }, "notes", "read"),
    denied("ONLINE_CHECK_REQUIRED"),
  );
});
test("known access end shortens the permit and does not grant seven extra days", async () => {
  const p = await permit({
    exp: (epoch + day) / 1000,
    accessUntil: (epoch + day) / 1000,
  });
  const c = await context({ permit: p, nowMs: epoch + day });
  assert.throws(
    () => requireOfflineAccess(c, "notes", "read"),
    denied("ONLINE_CHECK_REQUIRED"),
  );
});
for (const field of [
  "iss",
  "aud",
  "sub",
  "projectId",
  "vesselId",
  "deviceId",
  "sessionId",
])
  test(`rejects wrong ${field}`, async () => {
    await assert.rejects(
      verifyOfflinePermit(
        await signedToken({ [field]: "different" }),
        trustedKeys,
        scope,
      ),
      denied("INVALID_PERMIT"),
    );
  });
for (const overrides of [
  { exp: claims.iat },
  { exp: claims.exp + 1 },
  { accessUntil: claims.exp - 1 },
  { iat: "yesterday" },
  { exp: null },
  { permissions: { payments: ["create"] } },
  { permissions: { notes: ["delete"] } },
  { permissions: [] },
  { permissions: null },
])
  test(`rejects invalid signed claims ${JSON.stringify(overrides)}`, async () => {
    await assert.rejects(
      verifyOfflinePermit(await signedToken(overrides), trustedKeys, scope),
      denied("INVALID_PERMIT"),
    );
  });
for (const header of [
  { alg: "none" },
  { kid: "unknown" },
  { typ: "JWT" },
  { jku: "https://attacker.test" },
]) {
  test(`rejects untrusted token header ${JSON.stringify(header)}`, async () => {
    await assert.rejects(
      verifyOfflinePermit(await signedToken({}, header), trustedKeys, scope),
      denied("INVALID_PERMIT"),
    );
  });
}
test("tampering invalidates the signature", async () => {
  const parts = (await signedToken()).split(".");
  parts[1] = Buffer.from(
    JSON.stringify({ ...claims, exp: claims.exp + 99 }),
  ).toString("base64url");
  await assert.rejects(
    verifyOfflinePermit(parts.join("."), trustedKeys, scope),
    denied("INVALID_PERMIT"),
  );
});
test("cached JSON is never treated as a verified permit", async () => {
  const c = await context({ permit: { claims } });
  assert.throws(
    () => requireOfflineAccess(c, "notes", "read"),
    denied("ONLINE_CHECK_REQUIRED"),
  );
});
test("read-only permit cannot edit", async () => {
  const c = await context({
    permit: await permit({ permissions: { notes: ["read"] } }),
  });
  assert.throws(
    () => requireOfflineAccess(c, "notes", "create"),
    denied("ACTION_NOT_ALLOWED"),
  );
});
test("known revocation wins over an unexpired permit", async () => {
  const c = await context({ blocked: true });
  assert.throws(
    () => requireOfflineAccess(c, "notes", "read"),
    denied("ACCESS_BLOCKED"),
  );
});
for (const feature of [
  "plans",
  "payments",
  "inviteCodes",
  "users",
  "devices",
  "deleteAccount",
])
  test(`${feature} stays online-only`, async () => {
    const c = await context();
    assert.throws(
      () => requireOfflineAccess(c, feature, "create"),
      denied("ONLINE_ONLY"),
    );
  });
test("clock rollback and invalid clocks require online check", async () => {
  for (const nowMs of [epoch - 180_000, NaN, Infinity, -1]) {
    const c = await context({ nowMs });
    assert.throws(
      () => requireOfflineAccess(c, "notes", "read"),
      denied("CLOCK_CHECK_REQUIRED"),
    );
  }
});
test("a small clock correction cannot extend the effective expiry", async () => {
  const c = await context({
    nowMs: epoch + 7 * day - 10,
    highestObservedMs: epoch + 7 * day,
  });
  assert.throws(
    () => requireOfflineAccess(c, "notes", "read"),
    denied("ONLINE_CHECK_REQUIRED"),
  );
});
test("scope binding is rechecked after account switch", async () => {
  const c = await context({ scope: { ...scope, userId: "other-user" } });
  assert.throws(
    () => requireOfflineAccess(c, "notes", "read"),
    denied("SCOPE_CHANGED"),
  );
});
test("scope keys include every boundary without delimiter collisions", () => {
  const keys = new Set([
    scopeKey(scope),
    ...Object.keys(scope).map((k) =>
      scopeKey({
        ...scope,
        [k]: k === "origin" ? "https://other.test" : "other",
      }),
    ),
  ]);
  assert.equal(keys.size, 7);
});
