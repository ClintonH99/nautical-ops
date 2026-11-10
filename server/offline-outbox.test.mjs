import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  scope,
  note,
  epoch,
  day,
  success,
  transport,
} from "./offline-fixtures.mjs";
const denied = (code) => (e) => e.code === code;
test("saved-on-device survives reconstructing the engine", async () => {
  const f = await fixture();
  const result = await f.create();
  assert.equal(result.saved, "device");
  assert.deepEqual((await f.makeBox().read("notes", "note-1")).value, note);
  assert.equal((await f.store.read(scope)).changes.length, 1);
});
test("unsent edits coalesce but retain create semantics", async () => {
  const f = await fixture();
  await f.create();
  await f.box.save({
    feature: "notes",
    recordId: "note-1",
    kind: "update",
    value: { ...note, title: "Changed" },
    expectedLocalVersion: 1,
  });
  const state = await f.store.read(scope);
  assert.equal(state.changes.length, 1);
  assert.equal(state.changes[0].kind, "create");
  assert.equal(state.changes[0].value.title, "Changed");
});
test("two concurrent edits cannot silently overwrite each other", async () => {
  const f = await fixture();
  await f.create();
  const edit = (title) => ({
    feature: "notes",
    recordId: "note-1",
    kind: "update",
    value: { ...note, title },
    expectedLocalVersion: 1,
  });
  const results = await Promise.allSettled([
    f.box.save(edit("first")),
    f.makeBox().save(edit("second")),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.find((r) => r.status === "rejected").reason.code,
    "LOCAL_CONFLICT",
  );
});
test("quota or persistence failure never reports saved", async () => {
  const f = await fixture();
  f.store.failWrites = true;
  await assert.rejects(f.create());
  assert.equal((await f.store.read(scope)).changes.length, 0);
});
test("expiry retains queued work and a later clock rollback cannot reopen it", async () => {
  const f = await fixture();
  await f.create();
  f.context.nowMs = epoch + 7 * day;
  await assert.rejects(
    f.box.read("notes", "note-1"),
    denied("ONLINE_CHECK_REQUIRED"),
  );
  assert.equal((await f.store.read(scope)).changes.length, 1);
  f.context.nowMs = epoch;
  await assert.rejects(
    f.box.read("notes", "note-1"),
    denied("CLOCK_CHECK_REQUIRED"),
  );
});
test("new user and vessel see neither cached data nor pending work", async () => {
  const f = await fixture();
  await f.create();
  for (const k of [
    "userId",
    "vesselId",
    "deviceId",
    "sessionId",
    "projectId",
  ]) {
    const other = { ...scope, [k]: "other" };
    assert.deepEqual((await f.store.read(other)).changes, []);
    assert.deepEqual((await f.store.read(other)).records, {});
  }
});
test("online refresh does not overwrite pending data", async () => {
  const f = await fixture();
  await f.create();
  assert.equal(
    await f.box.cache(
      "notes",
      "note-1",
      { ...note, title: "Server" },
      "server-r1",
    ),
    false,
  );
  assert.equal((await f.box.read("notes", "note-1")).value.title, note.title);
});
test("update includes the original server revision", async () => {
  const f = await fixture();
  await f.box.cache("notes", "note-1", note, "server-r1");
  await f.box.save({
    feature: "notes",
    recordId: "note-1",
    kind: "update",
    value: { ...note, title: "New" },
    expectedLocalVersion: 1,
  });
  assert.equal(
    (await f.store.read(scope)).changes[0].baseRevision,
    "server-r1",
  );
});
test("forbidden rows and unknown fields are not queued", async () => {
  const f = await fixture();
  await assert.rejects(
    f.box.save({
      feature: "notes",
      recordId: "note-1",
      kind: "create",
      value: { ...note, ownerId: "other" },
      expectedLocalVersion: 0,
    }),
    denied("ACTION_NOT_ALLOWED"),
  );
  await assert.rejects(
    f.box.save({
      feature: "notes",
      recordId: "note-1",
      kind: "create",
      value: { ...note, access_token: "must-not-save" },
      expectedLocalVersion: 0,
    }),
    denied("FEATURE_NOT_READY"),
  );
  assert.equal((await f.store.read(scope)).changes.length, 0);
});
test("missing base and oversized records are rejected", async () => {
  const f = await fixture();
  await assert.rejects(
    f.box.save({
      feature: "notes",
      recordId: "note-1",
      kind: "update",
      value: note,
      expectedLocalVersion: 0,
    }),
    denied("INVALID_BASE"),
  );
  await assert.rejects(
    f.box.save({
      feature: "notes",
      recordId: "note-1",
      kind: "create",
      value: { ...note, content: "x".repeat(256_001) },
      expectedLocalVersion: 0,
    }),
    denied("RECORD_TOO_LARGE"),
  );
});
test("fresh access denial prevents any upload", async () => {
  const f = await fixture();
  await f.create();
  let calls = 0;
  const r = await f.box.sync(
    transport(
      async () => {
        calls++;
      },
      async () => false,
    ),
  );
  assert.equal(r.stopped, "ACCESS_RECHECK_FAILED");
  assert.equal(calls, 0);
  assert.equal((await f.store.read(scope)).changes.length, 1);
});
test("account switch during access check prevents upload", async () => {
  const f = await fixture();
  await f.create();
  let calls = 0;
  await assert.rejects(
    f.box.sync(
      transport(
        async () => {
          calls++;
        },
        async () => {
          f.context.scope = { ...scope, userId: "other" };
          return true;
        },
      ),
    ),
    denied("SCOPE_CHANGED"),
  );
  assert.equal(calls, 0);
});
test("server acknowledgement removes only the confirmed operation", async () => {
  const f = await fixture();
  await f.create();
  const r = await f.box.sync(transport());
  assert.equal(r.synced, 1);
  assert.deepEqual((await f.store.read(scope)).changes, []);
  assert.equal(
    (await f.box.read("notes", "note-1")).serverRevision,
    "server-r2",
  );
});
test("ambiguous network failure retains the identical operation ID for safe retry", async () => {
  const f = await fixture();
  await f.create();
  const ids = [];
  const serverSeen = new Map();
  let attempts = 0;
  const t = transport(async (_scope, op) => {
    ids.push(op.id);
    if (!serverSeen.has(op.id)) serverSeen.set(op.id, success(op));
    if (attempts++ === 0) throw Error("response lost after commit");
    return serverSeen.get(op.id);
  });
  assert.equal((await f.box.sync(t)).stopped, "RETRY_LATER");
  assert.equal((await f.store.read(scope)).changes.length, 1);
  assert.equal((await f.box.sync(t)).synced, 1);
  assert.equal(ids[0], ids[1]);
  assert.equal(serverSeen.size, 1);
});
for (const status of ["conflict", "forbidden"])
  test(`${status} preserves work and is not automatically retried`, async () => {
    const f = await fixture();
    await f.create();
    let calls = 0;
    const t = transport(async () => {
      calls++;
      return { status };
    });
    await f.box.sync(t);
    await f.box.sync(t);
    const p = (await f.store.read(scope)).changes[0];
    assert.equal(calls, 1);
    assert.equal(p.state, status === "conflict" ? "conflict" : "blocked");
    assert.deepEqual(p.value, note);
  });
test("invalid or mismatched acknowledgements do not delete work", async () => {
  for (const response of [
    null,
    { status: "applied" },
    {
      status: "applied",
      operationId: "wrong",
      recordId: "note-1",
      revision: "r",
      value: note,
    },
  ]) {
    const f = await fixture();
    await f.create();
    assert.equal(
      (await f.box.sync(transport(async () => response))).stopped,
      "RETRY_LATER",
    );
    assert.equal((await f.store.read(scope)).changes.length, 1);
  }
});
test("attempted payload cannot be changed under an idempotency key", async () => {
  const f = await fixture();
  await f.create();
  await f.box.sync(
    transport(async () => {
      throw Error("offline");
    }),
  );
  const original = (await f.store.read(scope)).changes[0];
  await f.box.save({
    feature: "notes",
    recordId: "note-1",
    kind: "update",
    value: { ...note, title: "different" },
    expectedLocalVersion: 1,
  });
  const changes = (await f.store.read(scope)).changes;
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0], original);
  assert.equal(changes[1].afterId, original.id);
  assert.equal(changes[1].value.title, "different");
});
test("cross-tab send claim prevents simultaneous uploads", async () => {
  const f = await fixture();
  await f.create();
  let release;
  let entered;
  const started = new Promise((r) => {
    entered = r;
  });
  const held = new Promise((r) => {
    release = r;
  });
  let calls = 0;
  const t = transport(async (_s, op) => {
    calls++;
    entered();
    await held;
    return success(op);
  });
  const first = f.box.sync(t);
  await started;
  await f.makeBox().sync(t);
  release();
  await first;
  assert.equal(calls, 1);
});
test("known blocked account cannot sync even with a successful transport", async () => {
  const f = await fixture();
  await f.create();
  f.context.blocked = true;
  await assert.rejects(f.box.sync(transport()), denied("ACCESS_BLOCKED"));
  assert.equal((await f.store.read(scope)).changes.length, 1);
});
test("fresh data from the wrong record owner is not cached", async () => {
  const f = await fixture();
  await assert.rejects(
    f.box.cache(
      "notes",
      "other-note",
      { ...note, ownerId: "other-user" },
      "r1",
    ),
    denied("ACTION_NOT_ALLOWED"),
  );
  assert.equal(await f.box.read("notes", "other-note"), null);
});
test("pending conflicts remain visible in later sync results", async () => {
  const f = await fixture();
  await f.create();
  await f.box.sync(transport(async () => ({ status: "conflict" })));
  assert.equal((await f.box.sync(transport())).stopped, "CONFLICT");
});
test("abandoned send claims are retried using the same immutable payload", async () => {
  const f = await fixture();
  await f.create();
  await f.store.update(scope, (state) => {
    state.changes[0].state = "sending";
    state.changes[0].claim = "closed-tab";
    state.changes[0].claimUntil = epoch - 1;
    state.changes[0].attempts = 1;
  });
  const original = (await f.store.read(scope)).changes[0];
  let sent;
  assert.equal(
    (
      await f.makeBox().sync(
        transport(async (_s, op) => {
          sent = op;
          return success(op);
        }),
      )
    ).synced,
    1,
  );
  assert.equal(sent.id, original.id);
  assert.deepEqual(sent.value, original.value);
  assert.equal("attempts" in sent, false);
  assert.equal("claim" in sent, false);
});
test("account switch during an upload acknowledges only its original partition", async () => {
  const f = await fixture();
  await f.create();
  await f.create("note-2");
  let calls = 0;
  const t = transport(async (_s, op) => {
    calls++;
    f.context.scope = { ...scope, userId: "other" };
    return success(op);
  });
  await assert.rejects(f.box.sync(t), denied("SCOPE_CHANGED"));
  assert.equal(calls, 1);
  assert.equal((await f.store.read(scope)).changes.length, 1);
  assert.equal((await f.store.read(f.context.scope)).changes.length, 0);
});
test("wrong-owner acknowledgement does not replace or discard pending work", async () => {
  const f = await fixture();
  await f.create();
  const result = await f.box.sync(
    transport(async (_s, op) => ({
      ...success(op),
      value: { ...note, ownerId: "other-user" },
    })),
  );
  assert.equal(result.stopped, "RETRY_LATER");
  assert.equal((await f.store.read(scope)).changes.length, 1);
  assert.deepEqual((await f.box.read("notes", "note-1")).value, note);
});

test("lists distinguish an empty downloaded collection from one never downloaded", async () => {
  const f = await fixture();
  await assert.rejects(f.box.list("notes"), denied("NOT_DOWNLOADED"));
  await f.box.replaceSnapshot("notes", []);
  assert.deepEqual(await f.box.list("notes"), []);
});
test("unchanged snapshots preserve the version held by an open form", async () => {
  const f = await fixture();
  const rows = [{ recordId: "note-1", value: note, revision: "r1" }];
  await f.box.replaceSnapshot("notes", rows);
  const first = await f.box.read("notes", "note-1");
  await f.box.replaceSnapshot("notes", rows);
  assert.equal(
    (await f.box.read("notes", "note-1")).localVersion,
    first.localVersion,
  );
  await f.box.save({
    feature: "notes",
    recordId: "note-1",
    kind: "update",
    value: { ...note, title: "Still editable" },
    expectedLocalVersion: first.localVersion,
  });
});
test("a fresh snapshot removes deleted online records but retains pending edits", async () => {
  const f = await fixture();
  await f.box.replaceSnapshot("notes", [
    { recordId: "server-note", value: note, revision: "r1" },
  ]);
  await f.create();
  await f.box.replaceSnapshot("notes", []);
  assert.equal(await f.box.read("notes", "server-note"), null);
  assert.equal((await f.box.list("notes")).length, 1);
  assert.equal((await f.store.read(scope)).changes.length, 1);
});
test("a mixed-owner snapshot fails atomically and preserves existing notes", async () => {
  const f = await fixture();
  await f.box.replaceSnapshot("notes", [
    { recordId: "server-note", value: note, revision: "r1" },
  ]);
  await assert.rejects(
    f.box.replaceSnapshot("notes", [
      {
        recordId: "bad",
        value: { ...note, ownerId: "someone-else" },
        revision: "r2",
      },
    ]),
    denied("INVALID_RECORD"),
  );
  assert.equal((await f.box.list("notes")).length, 1);
});
test("keep-both creates a new queued record without updating the online original", async () => {
  const f = await fixture();
  await f.create();
  await f.box.sync(transport(async () => ({ status: "conflict" })));
  const original = (await f.store.read(scope)).changes[0];
  await f.box.forkConflict(original.id, "device-copy", {
    ...note,
    title: "Device copy",
  });
  const pending = (await f.store.read(scope)).changes;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].recordId, "device-copy");
  assert.equal(pending[0].kind, "create");
  assert.equal(pending[0].baseRevision, null);
  assert.notEqual(pending[0].id, original.id);
  await assert.rejects(
    f.box.forkConflict(original.id, "duplicate", note),
    denied("CONFLICT_CHANGED"),
  );
});
test("failed keep-both transaction keeps the original conflict and contents", async () => {
  const f = await fixture();
  await f.create();
  await f.box.sync(transport(async () => ({ status: "conflict" })));
  const original = (await f.store.read(scope)).changes[0];
  f.store.failWrites = true;
  await assert.rejects(f.box.forkConflict(original.id, "copy", note));
  assert.deepEqual((await f.store.read(scope)).changes, [original]);
});
test("ambiguous pending requests cannot be forked as confirmed conflicts", async () => {
  const f = await fixture();
  await f.create();
  await f.box.sync(transport(async () => ({ status: "retry" })));
  const original = (await f.store.read(scope)).changes[0];
  await assert.rejects(
    f.box.forkConflict(original.id, "copy", note),
    denied("CONFLICT_CHANGED"),
  );
});
