import test from "node:test";
import assert from "node:assert/strict";
import { restAdapter } from "../yachy-app/src/offline/restAdapter.ts";
import { OfflineOutbox } from "../yachy-app/src/offline/outbox.ts";
import { MemoryStore, scope, permit, epoch } from "./offline-fixtures.mjs";
const value = {
  id: "rest-1",
  vessel_id: scope.vesselId,
  user_id: scope.userId,
  date: "2026-11-01",
  rest_periods: [{ start: "23:00", end: "03:00" }],
  work_start: "08:00",
  work_end: "17:00",
  lunch_start: null,
  lunch_end: null,
  comment: "Truthful short rest",
  status: "draft",
  confirmed_by: null,
  confirmed_at: null,
  created_at: "local",
  updated_at: "local",
  watch_versions: {},
};
async function fixture(captain = false) {
  const store = new MemoryStore(),
    ctx = {
      scope,
      permit: await permit({
        permissions: {
          restEntries: ["read", "create", "update"],
          ...(captain ? { restReview: ["read", "create", "update"] } : {}),
        },
      }),
      nowMs: epoch,
      highestObservedMs: epoch,
      blocked: false,
    };
  const box = new OfflineOutbox({
    store,
    context: () => ctx,
    adapters: {
      restEntries: restAdapter(false),
      restReview: restAdapter(true),
    },
  });
  return {
    store,
    ctx,
    box,
    save: (v, kind, version) =>
      box.save({
        feature: "restEntries",
        recordId: v.id,
        kind,
        value: v,
        expectedLocalVersion: version,
      }),
  };
}
test("rest validates real clock values without suppressing short/noncompliant records", () => {
  const a = restAdapter(false);
  assert.ok(a.validate(value));
  assert.ok(a.validate({ ...value, rest_periods: [] }));
  for (const bad of [
    { work_start: "24:01" },
    { date: "2026-02-31" },
    { rest_periods: [{ start: "00:00", end: "01:00", admin: true }] },
    { extra: true },
    { watch_versions: { unexpected: "anything" } },
  ])
    assert.equal(a.validate({ ...value, ...bad }), false);
  assert.equal(a.authorizeRead(scope, { ...value, user_id: "other" }), false);
  assert.equal(restAdapter(true).authorizeRead(scope, value), false);
});
test("crew own drafts survive reopening; locks and foreign ownership remain enforced", async () => {
  const { box, store, ctx, save } = await fixture();
  await box.replaceSnapshot("restEntries", []);
  await save(value, "create", 0);
  await save({ ...value, comment: null }, "update", 1);
  const reopened = new OfflineOutbox({
    store,
    context: () => ctx,
    adapters: { restEntries: restAdapter(false) },
  });
  assert.equal((await reopened.list("restEntries"))[0].value.comment, null);
  await assert.rejects(
    save(
      { ...value, status: "confirmed", confirmed_by: scope.userId },
      "update",
      2,
    ),
    /ACTION_NOT_ALLOWED/,
  );
  await assert.rejects(
    save({ ...value, user_id: "other" }, "update", 2),
    /ACTION_NOT_ALLOWED/,
  );
  await save({ ...value, status: "pending_confirmation" }, "update", 2);
  await assert.rejects(save(value, "update", 3), /ACTION_NOT_ALLOWED/);
});
test("confirmed metadata changes survive lost-reply dependent edits without duplicating work", async () => {
  const { box, store, save } = await fixture(true);
  await box.replaceSnapshot("restEntries", []);
  await save(value, "create", 0);
  const seen = [];
  let fail = true;
  const transport = {
    protocol: "offline-mutation-v1",
    revalidate: async () => true,
    apply: async (_, op) => {
      seen.push(op);
      if (fail) {
        fail = false;
        throw Error("reply lost");
      }
      return {
        status: "applied",
        operationId: op.id,
        recordId: op.recordId,
        value: {
          ...op.value,
          confirmed_at: op.value.status === "confirmed" ? "server-time" : null,
        },
        revision: "rev-" + seen.length,
      };
    },
  };
  await box.sync(transport);
  await save(
    {
      ...value,
      status: "confirmed",
      confirmed_by: scope.userId,
      confirmed_at: "device-time",
    },
    "update",
    1,
  );
  await box.sync(transport);
  assert.equal((await store.read(scope)).changes.length, 0);
  assert.equal(seen.at(-1).value.status, "confirmed");
  assert.equal(seen.at(-1).value.confirmed_by, scope.userId);
  assert.equal(
    (await box.read("restEntries", value.id)).value.confirmed_at,
    "server-time",
  );
  assert.equal(seen[0].id, seen[1].id);
  assert.notEqual(seen[1].id, seen[2].id);
});
test("captain capability is signed; fake role labels cannot allow review and downgrade locks cache", async () => {
  const { box, ctx } = await fixture(true);
  const other = { ...value, user_id: "other" };
  await box.replaceSnapshot("restReview", [
    { recordId: other.id, value: other, revision: "r1" },
  ]);
  assert.equal(
    (await box.bundle(["restEntries", "restReview"]).catch((e) => e)).code,
    "NOT_DOWNLOADED",
  );
  assert.equal((await box.list("restReview")).length, 1);
  ctx.permit = await permit({
    permissions: { restEntries: ["read", "create", "update"] },
  });
  await assert.rejects(box.list("restReview"), /ACTION_NOT_ALLOWED/);
});
test("historical comments retained but oversized changed text and Unicode pairs are limited", async () => {
  const { box, save } = await fixture();
  const old = {
    ...value,
    comment: "A historical comment much longer than twenty characters",
  };
  await box.replaceSnapshot("restEntries", [
    { recordId: value.id, value: old, revision: "r1" },
  ]);
  await save({ ...old, work_start: "09:00" }, "update", 1);
  await assert.rejects(
    save({ ...old, comment: "😀".repeat(11) }, "update", 2),
    /ACTION_NOT_ALLOWED/,
  );
});
