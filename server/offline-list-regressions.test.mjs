import test from "node:test";
import assert from "node:assert/strict";
import { OfflineOutbox } from "../yachy-app/src/offline/outbox.ts";
import { shoppingAdapter } from "../yachy-app/src/offline/shoppingAdapter.ts";
import { runBoundedTasks } from "../yachy-app/src/offline/boundedTasks.ts";
import { MemoryStore, scope, permit, epoch } from "./offline-fixtures.mjs";
const value = {
  id: "list-1",
  vessel_id: scope.vesselId,
  department: "BRIDGE",
  title: "Supplies",
  items: [{ text: "Rope", checked: false }],
  created_at: new Date(epoch).toISOString(),
  created_by: scope.userId,
  list_type: "general",
  is_master: false,
};
async function fixture() {
  const store = new MemoryStore();
  const context = {
    scope: { ...scope },
    permit: await permit({
      permissions: { shoppingLists: ["read", "create", "update"] },
    }),
    nowMs: epoch,
    highestObservedMs: epoch,
    blocked: false,
  };
  const box = new OfflineOutbox({
    store,
    context: () => context,
    adapters: { shoppingLists: shoppingAdapter },
  });
  await box.replaceSnapshot("shoppingLists", [
    { recordId: value.id, value, revision: "r1" },
  ]);
  return { box, store, context };
}
test("a confirmed online deletion disappears from cached lists immediately and after reopening", async () => {
  const { box, store, context } = await fixture();
  await box.forgetDeletedRecord("shoppingLists", value.id);
  assert.deepEqual(await box.list("shoppingLists"), []);
  const reopened = new OfflineOutbox({
    store,
    context: () => context,
    adapters: { shoppingLists: shoppingAdapter },
  });
  assert.deepEqual(await reopened.list("shoppingLists"), []);
});
test("deletion cleanup cannot discard another tab’s pending edit", async () => {
  const { box } = await fixture();
  await box.save({
    feature: "shoppingLists",
    recordId: value.id,
    value: { ...value, title: "Pending" },
    kind: "update",
    expectedLocalVersion: 1,
  });
  await assert.rejects(box.forgetDeletedRecord("shoppingLists", value.id), {
    code: "RECONCILE_FIRST",
  });
  assert.equal(
    (await box.read("shoppingLists", value.id)).value.title,
    "Pending",
  );
});
test("initial download starts four independent sections and never exceeds the limit", async () => {
  let running = 0,
    peak = 0,
    completed = 0;
  const release = [];
  const work = runBoundedTasks(
    Array.from({ length: 12 }, () => async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => release.push(resolve));
      running--;
      completed++;
    }),
  );
  assert.equal(running, 4);
  while (completed < 12) {
    release.splice(0).forEach((resolve) => resolve());
    await new Promise((resolve) => setImmediate(resolve));
  }
  await work;
  assert.equal(peak, 4);
});
test("a failed download settles started writes and does not schedule remaining work", async () => {
  let release,
    settled = false,
    extra = false;
  const failure = new Error("Access changed");
  const work = runBoundedTasks(
    [
      async () => {
        throw failure;
      },
      async () => {
        await new Promise((resolve) => {
          release = resolve;
        });
        settled = true;
      },
      async () => {
        extra = true;
      },
    ],
    2,
  );
  await Promise.resolve();
  assert.equal(extra, false);
  release();
  await assert.rejects(work, failure);
  assert.equal(settled, true);
});

test("a second device removes a remotely deleted list after a fresh snapshot and restart", async () => {
  const laptop = await fixture();
  const phone = await fixture();
  await laptop.box.forgetDeletedRecord("shoppingLists", value.id);
  assert.equal((await phone.box.list("shoppingLists")).length, 1);
  await phone.box.replaceSnapshot("shoppingLists", []);
  const reopened = new OfflineOutbox({
    store: phone.store,
    context: () => phone.context,
    adapters: { shoppingLists: shoppingAdapter },
  });
  assert.deepEqual(await reopened.list("shoppingLists"), []);
});
test("remote deletion refresh preserves unsynced phone edits for review", async () => {
  const { box, store } = await fixture();
  await box.save({
    feature: "shoppingLists",
    recordId: value.id,
    value: { ...value, title: "Unsynced phone changes" },
    kind: "update",
    expectedLocalVersion: 1,
  });
  await box.replaceSnapshot("shoppingLists", []);
  assert.equal(
    (await box.read("shoppingLists", value.id)).value.title,
    "Unsynced phone changes",
  );
  assert.equal((await store.read(scope)).changes.length, 1);
});
