import test from "node:test";
import assert from "node:assert/strict";
import {
  planRecovery,
  recoveryCount,
} from "../yachy-app/src/offline/recovery.ts";
import { scopeKey } from "../yachy-app/src/offline/access.ts";
import { emptyPartition } from "../yachy-app/src/offline/outbox.ts";
import { fixture, scope } from "./offline-fixtures.mjs";
const renewed = { ...scope, sessionId: "renewed-session" };
test("recovery preserves the exact operation ID, payload and base for server deduplication", async () => {
  const f = await fixture();
  await f.create();
  const old = await f.store.read(scope);
  old.changes[0].attempts = 2;
  old.changes[0].state = "sending";
  old.changes[0].claim = "old-tab";
  const plan = planRecovery([[scopeKey(scope), old]], renewed, () => true);
  assert.equal(plan.moved, 1);
  const target = plan.updates.find(([key]) => key === scopeKey(renewed))[1];
  assert.equal(target.changes[0].id, old.changes[0].id);
  assert.deepEqual(target.changes[0].value, old.changes[0].value);
  assert.equal(target.changes[0].baseRevision, old.changes[0].baseRevision);
  assert.equal(target.changes[0].attempts, 2);
  assert.equal(target.changes[0].state, "pending");
  assert.equal(target.changes[0].claim, null);
  assert.equal(
    plan.updates.find(([key]) => key === scopeKey(scope))[1].changes.length,
    0,
  );
  assert.equal(old.changes.length, 1, "planning never mutates persisted input");
});
for (const field of ["origin", "projectId", "userId", "vesselId", "deviceId"])
  test("recovery never crosses " + field, async () => {
    const f = await fixture();
    await f.create();
    const entries = [[scopeKey(scope), await f.store.read(scope)]];
    const different = {
      ...renewed,
      [field]: field === "origin" ? "https://different.example" : "different",
    };
    assert.equal(recoveryCount(entries, different), 0);
    assert.equal(planRecovery(entries, different, () => true).moved, 0);
  });
test("permission denial preserves old-session work", async () => {
  const f = await fixture();
  await f.create();
  assert.equal(
    planRecovery(
      [[scopeKey(scope), await f.store.read(scope)]],
      renewed,
      () => false,
    ).moved,
    0,
  );
});
test("independent edits to the same record are retained separately", async () => {
  const f = await fixture();
  await f.create();
  const old = await f.store.read(scope),
    current = structuredClone(old);
  current.changes[0].id = "another-edit";
  const plan = planRecovery(
    [
      [scopeKey(scope), old],
      [scopeKey(renewed), current],
    ],
    renewed,
    () => true,
  );
  assert.equal(plan.moved, 0);
  assert.equal(plan.updates.length, 0);
});
test("already recovered ID with a changed payload fails closed", async () => {
  const f = await fixture();
  await f.create();
  const old = await f.store.read(scope),
    current = structuredClone(old);
  current.changes[0].value.title = "Different";
  assert.throws(
    () =>
      planRecovery(
        [
          [scopeKey(scope), old],
          [scopeKey(renewed), current],
        ],
        renewed,
        () => true,
      ),
    (error) => error.code === "RECOVERY_CONFLICT",
  );
});
test("confirmed conflicts stay conflicts during recovery", async () => {
  const f = await fixture();
  await f.create();
  const old = await f.store.read(scope);
  old.changes[0].state = "conflict";
  const target = planRecovery(
    [
      [scopeKey(scope), old],
      [scopeKey(renewed), emptyPartition()],
    ],
    renewed,
    () => true,
  ).updates.find(([key]) => key === scopeKey(renewed))[1];
  assert.equal(target.changes[0].state, "conflict");
});
