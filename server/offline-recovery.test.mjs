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
test("clean Inventory preferences and saved entries do not block unfinished draft recovery", () => {
  const old = emptyPartition();
  old.drafts = {
    inventory: {
      version: 3,
      value: {
        enabled: true,
        entries: {
          one: {
            base: null,
            version: 2,
            savedVersion: 0,
            values: { title: "Draft" },
          },
        },
      },
    },
  };
  for (const entries of [
    {},
    { one: { base: { id: "one" }, version: 2, savedVersion: 2 } },
  ]) {
    const current = emptyPartition();
    current.drafts = {
      inventory: { version: 7, value: { enabled: true, ready: true, entries } },
    };
    assert.equal(recoveryCount([[scopeKey(scope), current]], renewed), 0);
    const plan = planRecovery(
      [
        [scopeKey(scope), old],
        [scopeKey(renewed), current],
      ],
      renewed,
      () => true,
      { draft: () => true },
    );
    assert.equal(plan.moved, 1);
    assert.equal(
      plan.updates.find(([k]) => k === scopeKey(renewed))[1].drafts.inventory
        .version,
      8,
    );
  }
  const current = structuredClone(old);
  assert.equal(
    planRecovery(
      [
        [scopeKey(scope), old],
        [scopeKey(renewed), current],
      ],
      renewed,
      () => true,
      { draft: () => true },
    ).moved,
    0,
  );
});
test("unfinished drafts recover without a queued server mutation and never replace a newer draft", () => {
  const old = emptyPartition();
  old.drafts = {
    inventory: { value: { title: "Unfinished inventory" }, version: 4 },
  };
  const entries = [[scopeKey(scope), old]];
  assert.equal(recoveryCount(entries, renewed), 1);
  const plan = planRecovery(entries, renewed, () => true, {
    draft: () => true,
  });
  assert.equal(plan.moved, 1);
  const target = plan.updates.find(([k]) => k === scopeKey(renewed))[1];
  assert.equal(target.drafts.inventory.value.title, "Unfinished inventory");
  assert.equal(target.drafts.inventory.version, 5);
  assert.equal(target.changes.length, 0);
  const current = emptyPartition();
  current.drafts = {
    inventory: { value: { title: "Newer draft" }, version: 1 },
  };
  assert.equal(
    planRecovery(
      [...entries, [scopeKey(renewed), current]],
      renewed,
      () => true,
      { draft: () => true },
    ).moved,
    0,
  );
  assert.equal(
    planRecovery(entries, renewed, () => true, { draft: () => false }).moved,
    0,
  );
});
test("preserved copies recover only after current read permission and remain outside the sync queue", () => {
  const old = emptyPartition();
  old.recoveryCopies = [
    {
      id: "copy",
      feature: "notes",
      recordId: "note",
      value: { title: "Preserved" },
      changes: [],
      savedAt: 1,
    },
  ];
  const entries = [[scopeKey(scope), old]];
  assert.equal(recoveryCount(entries, renewed), 1);
  assert.equal(planRecovery(entries, renewed, () => true).moved, 0);
  const plan = planRecovery(entries, renewed, () => true, { copy: () => true });
  const target = plan.updates.find(([k]) => k === scopeKey(renewed))[1];
  assert.equal(target.recoveryCopies.length, 1);
  assert.equal(target.changes.length, 0);
});
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
