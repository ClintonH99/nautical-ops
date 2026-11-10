import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  note,
  scope,
  transport,
  success,
  notesAdapter,
} from "./offline-fixtures.mjs";
import { planRecovery } from "../yachy-app/src/offline/recovery.ts";
import { scopeKey } from "../yachy-app/src/offline/access.ts";
test("server maintained fields do not create false conflicts or get overwritten by local metadata", async () => {
  const f = await fixture({}, { ...notesAdapter, serverFields: ["content"] });
  await f.create();
  await f.box.sync(transport(async () => ({ status: "retry" })));
  await f.box.save({
    feature: "notes",
    recordId: "note-1",
    kind: "update",
    value: { ...note, title: "Updated", content: "Device metadata" },
    expectedLocalVersion: 1,
  });
  const calls = [];
  const result = await f.box.sync(
    transport(async (_s, op) => {
      calls.push(op);
      return calls.length === 1
        ? { ...success(op), value: { ...note, content: "Server metadata" } }
        : success(op);
    }),
  );
  assert.equal(result.stopped, null);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].value.content, "Server metadata");
  assert.equal(calls[1].value.title, "Updated");
});
async function pending() {
  const f = await fixture();
  await f.create();
  await f.box.sync(
    transport(async () => {
      throw Error("reply lost");
    }),
  );
  return f;
}
const edit = (f, title, version) =>
  f.box.save({
    feature: "notes",
    recordId: "note-1",
    kind: "update",
    value: { ...note, title },
    expectedLocalVersion: version,
  });
test("newer edits after an ambiguous create survive reload and sync behind the unchanged original", async () => {
  const f = await pending();
  const original = (await f.store.read(scope)).changes[0];
  await edit(f, "Second version", 1);
  await edit(f, "Final version", 2);
  assert.equal(
    (await f.makeBox().read("notes", "note-1")).value.title,
    "Final version",
  );
  const calls = [];
  const result = await f.makeBox().sync(
    transport(async (_s, op) => {
      calls.push(op);
      return success(op);
    }),
  );
  assert.equal(result.stopped, null);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].id, original.id);
  assert.deepEqual(calls[0].value, original.value);
  assert.equal(calls[1].kind, "update");
  assert.equal(calls[1].baseRevision, "server-r2");
  assert.equal(calls[1].value.title, "Final version");
  assert.equal("afterId" in calls[1], false);
  assert.equal((await f.store.read(scope)).changes.length, 0);
});
test("parent failure never sends its dependent edit", async () => {
  const f = await pending();
  await edit(f, "New version", 1);
  let calls = 0;
  await f.box.sync(
    transport(async () => {
      calls++;
      return { status: "retry" };
    }),
  );
  assert.equal(calls, 1);
  assert.equal((await f.store.read(scope)).changes.length, 2);
});
test("a replay returning someone else's newer edit becomes a conflict, not an overwrite", async () => {
  const f = await pending();
  await edit(f, "My new title", 1);
  let calls = 0;
  const result = await f.box.sync(
    transport(async (_s, op) => {
      calls++;
      return {
        ...success(op),
        value: { ...note, title: "Another device changed title" },
      };
    }),
  );
  assert.equal(calls, 1);
  assert.equal(result.stopped, "CONFLICT");
  const state = await f.store.read(scope);
  assert.equal(state.changes[0].state, "conflict");
  assert.equal(state.changes[0].value.title, "My new title");
});
test("unrelated newer online fields are preserved when releasing a dependent edit", async () => {
  const f = await pending();
  await edit(f, "My new title", 1);
  const calls = [];
  await f.box.sync(
    transport(async (_s, op) => {
      calls.push(op);
      return calls.length === 1
        ? { ...success(op), value: { ...note, content: "New online content" } }
        : success(op);
    }),
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].value.title, "My new title");
  assert.equal(calls[1].value.content, "New online content");
});
test("keep both removes the parent and unsent dependency together and retains the latest device copy", async () => {
  const f = await pending();
  await edit(f, "Latest draft", 1);
  await f.box.sync(transport(async () => ({ status: "conflict" })));
  const parent = (await f.store.read(scope)).changes[0];
  const latest = await f.box.read("notes", "note-1");
  await f.box.forkConflict(parent.id, "device-copy", latest.value);
  const state = await f.store.read(scope);
  assert.equal(state.changes.length, 1);
  assert.equal(state.changes[0].recordId, "device-copy");
  assert.equal(state.changes[0].value.title, "Latest draft");
});
test("session recovery moves the dependency as one group without changing attempted payloads", async () => {
  const f = await pending();
  await edit(f, "New session draft", 1);
  const old = await f.store.read(scope);
  const next = { ...scope, sessionId: "new-session" };
  const plan = planRecovery([[scopeKey(scope), old]], next, () => true);
  assert.equal(plan.moved, 2);
  const target = plan.updates.find(([key]) => key === scopeKey(next))[1];
  assert.equal(target.changes[1].afterId, target.changes[0].id);
  assert.deepEqual(target.changes[0].value, old.changes[0].value);
  assert.equal(
    target.records[JSON.stringify(["notes", "note-1"])].value.title,
    "New session draft",
  );
});
test("partial permission denial does not split a recovery dependency", async () => {
  const f = await pending();
  await edit(f, "Keep together", 1);
  const old = await f.store.read(scope);
  const plan = planRecovery(
    [[scopeKey(scope), old]],
    { ...scope, sessionId: "new-session" },
    (change) => !change.afterId,
  );
  assert.equal(plan.moved, 0);
  assert.equal(plan.updates.length, 0);
});
test("edits saved while an upload is still in flight survive its eventual acknowledgement", async () => {
  const f = await fixture();
  await f.create();
  let release, entered;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const upload = f.box.sync(
    transport(async (_s, op) => {
      entered();
      await held;
      return success(op);
    }),
  );
  await started;
  await edit(f, "Typed during upload", 1);
  release();
  assert.equal((await upload).stopped, "PENDING_CHANGES");
  assert.equal(
    (await f.box.read("notes", "note-1")).value.title,
    "Typed during upload",
  );
  await f.box.sync(transport());
  assert.equal((await f.store.read(scope)).changes.length, 0);
});
test("local acknowledgement storage failure retains the parent and newer draft for retry", async () => {
  const f = await pending();
  await edit(f, "Retain after storage failure", 1);
  await assert.rejects(
    f.box.sync(
      transport(async (_s, op) => {
        f.store.failWrites = true;
        return success(op);
      }),
    ),
  );
  f.store.failWrites = false;
  f.context.nowMs += 60001;
  assert.equal((await f.store.read(scope)).changes.length, 2);
  const result = await f.box.sync(transport());
  assert.equal(result.stopped, null);
  assert.equal(
    (await f.box.read("notes", "note-1")).value.title,
    "Retain after storage failure",
  );
});
