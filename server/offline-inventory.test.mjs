import test from "node:test";
import assert from "node:assert/strict";
import { OfflineOutbox } from "../yachy-app/src/offline/outbox.ts";
import {
  inventoryAdapter,
  sameInventoryContents,
  inventoryDeviceCopy,
} from "../yachy-app/src/offline/inventoryAdapter.ts";
import { MemoryStore, scope, permit, epoch, day } from "./offline-fixtures.mjs";
const value = {
  id: "inventory-1",
  category_id: null,
  name: "Supplies",
  title: "Supplies",
  description: "Before",
  quantity: 0,
  location: "Locker",
  department: "BRIDGE",
  vessel_id: scope.vesselId,
  photo: null,
  last_edited_by: scope.userId,
  last_edited_by_name: "Test",
  last_edited_at: null,
  created_at: null,
  items: [{ amount: "2", item: "Rope" }],
};
async function fixture() {
  const store = new MemoryStore(),
    c = {
      scope: { ...scope },
      permit: await permit({
        permissions: { inventory: ["read", "create", "update"] },
      }),
      nowMs: epoch,
      highestObservedMs: epoch,
      blocked: false,
    };
  const box = () =>
    new OfflineOutbox({
      store,
      context: () => c,
      adapters: { inventory: inventoryAdapter },
    });
  return { store, c, box };
}
test("inventory validates exact fields and preserves unsupported legacy fields", () => {
  assert.equal(inventoryAdapter.validate(value), true);
  for (const patch of [
    { items: [{ item: "Rope" }] },
    { items: [{ amount: "1", item: "Rope", extra: true }] },
    { quantity: 1.5 },
    { department: "ADMIN" },
    { unexpected: true },
  ])
    assert.equal(inventoryAdapter.validate({ ...value, ...patch }), false);
  assert.equal(
    inventoryAdapter.authorize(
      scope,
      "create",
      { ...value, photo: "private-url" },
      null,
    ),
    false,
  );
  assert.equal(
    inventoryAdapter.authorize(
      scope,
      "update",
      { ...value, quantity: 3 },
      { value },
    ),
    false,
  );
  assert.equal(
    inventoryAdapter.authorizeRead(scope, { ...value, vessel_id: "other" }),
    false,
  );
  assert.equal(
    inventoryAdapter.validate(inventoryDeviceCopy(value, "copy")),
    true,
  );
});
test("inventory device edits collapse before upload and reject stale editors", async () => {
  const { box, store } = await fixture();
  await box().save({
    feature: "inventory",
    recordId: value.id,
    kind: "create",
    value,
    expectedLocalVersion: 0,
  });
  await box().save({
    feature: "inventory",
    recordId: value.id,
    kind: "update",
    value: { ...value, description: "", items: [] },
    expectedLocalVersion: 1,
  });
  assert.equal((await store.read(scope)).changes.length, 1);
  assert.deepEqual((await box().read("inventory", value.id)).value.items, []);
  await assert.rejects(
    box().save({
      feature: "inventory",
      recordId: value.id,
      kind: "update",
      value,
      expectedLocalVersion: 1,
    }),
    (error) => error.code === "LOCAL_CONFLICT",
  );
});
test("draft CAS survives reopen and refuses another tab overwriting its newer contents", async () => {
  const { box } = await fixture();
  assert.equal((await box().readDraft("inventory")).version, 0);
  assert.equal(
    await box().writeDraft(
      "inventory",
      { entries: { a: { title: "First" } } },
      0,
    ),
    1,
  );
  await assert.rejects(
    box().writeDraft("inventory", { entries: { b: { title: "Stale" } } }, 0),
    (error) => error.code === "LOCAL_CONFLICT",
  );
  assert.deepEqual((await box().readDraft("inventory")).value, {
    entries: { a: { title: "First" } },
  });
});
test("drafts obey access expiry, preserve work, and never cross sessions", async () => {
  const { box, c, store } = await fixture();
  await box().writeDraft("inventory", { entries: { draft: "Keep" } }, 0);
  c.nowMs = epoch + 7 * day;
  await assert.rejects(box().readDraft("inventory"), /ONLINE_CHECK_REQUIRED/);
  await assert.rejects(
    box().writeDraft("inventory", { entries: {} }, 1),
    /ONLINE_CHECK_REQUIRED/,
  );
  assert.deepEqual((await store.read(scope)).drafts.inventory.value, {
    entries: { draft: "Keep" },
  });
  assert.equal(
    (await store.read({ ...scope, sessionId: "other" })).drafts,
    undefined,
  );
});
test("read-only permissions cannot persist an editable draft", async () => {
  const { box, c } = await fixture();
  c.permit = await permit({ permissions: { inventory: ["read"] } });
  await assert.rejects(
    box().writeDraft("inventory", { entries: {} }, 0),
    /ACTION_NOT_ALLOWED/,
  );
});
test("failed durable draft write leaves the previous copy intact", async () => {
  const { box, store } = await fixture();
  await box().writeDraft("inventory", { entries: { draft: "Keep" } }, 0);
  store.failWrites = true;
  await assert.rejects(box().writeDraft("inventory", { entries: {} }, 1));
  assert.equal((await store.read(scope)).drafts.inventory.version, 1);
});

test("server JSON key ordering and audit timestamps do not create false inventory conflicts", () => {
  const original = { ...value, items: [{ amount: "2", item: "Rope" }] };
  assert.equal(
    sameInventoryContents(original, {
      ...value,
      items: [{ item: "Rope", amount: "2" }],
      last_edited_at: "new",
    }),
    true,
  );
  assert.equal(
    sameInventoryContents(original, {
      ...value,
      items: [{ item: "Rope", amount: "3" }],
    }),
    false,
  );
  assert.equal(
    sameInventoryContents(
      { ...original, description: "" },
      { ...original, description: null },
    ),
    true,
  );
});
