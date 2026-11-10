import test from "node:test";
import assert from "node:assert/strict";
import { OfflineOutbox } from "../yachy-app/src/offline/outbox.ts";
import {
  checklistsAdapter,
  checklistDeviceCopy,
  mergeChecklistItems,
} from "../yachy-app/src/offline/checklistsAdapter.ts";
import {
  MemoryStore,
  scope,
  permit,
  epoch,
  transport,
  success,
} from "./offline-fixtures.mjs";
const value = {
  id: "check-1",
  vessel_id: scope.vesselId,
  trip_id: null,
  department: null,
  title: "Departure",
  created_by: scope.userId,
  created_at: "local",
  items: [
    {
      id: "item-1",
      checklist_id: "check-1",
      label: "Fuel",
      sort_order: 0,
      checked: false,
      created_at: "local",
    },
  ],
};
async function fixture() {
  const store = new MemoryStore(),
    c = {
      scope,
      permit: await permit({
        permissions: { preDepartureChecklists: ["read", "create", "update"] },
      }),
      nowMs: epoch,
      highestObservedMs: epoch,
      blocked: false,
    };
  const box = () =>
    new OfflineOutbox({
      store,
      context: () => c,
      adapters: { preDepartureChecklists: checklistsAdapter },
    });
  const save = (data, kind, version) =>
    box().save({
      feature: "preDepartureChecklists",
      recordId: value.id,
      kind,
      value: data,
      expectedLocalVersion: version,
    });
  return { store, c, box, save };
}
test("checklist child IDs are unique, scoped and exact; copies generate new children", () => {
  assert.equal(checklistsAdapter.validate(value), true);
  for (const items of [
    [...value.items, ...value.items],
    [{ ...value.items[0], checklist_id: "other" }],
    [{ ...value.items[0], checked: "true" }],
    [{ ...value.items[0], extra: true }],
  ])
    assert.equal(checklistsAdapter.validate({ ...value, items }), false);
  const copy = checklistDeviceCopy(value, "copy", scope.userId);
  assert.equal(checklistsAdapter.validate(copy), true);
  assert.notEqual(copy.items[0].id, value.items[0].id);
  assert.equal(copy.items[0].checklist_id, "copy");
  assert.equal(
    checklistsAdapter.authorizeRead(scope, { ...value, vessel_id: "other" }),
    false,
  );
});
test("checklist create and item edits survive reopen as one pending aggregate", async () => {
  const f = await fixture();
  await f.save(value, "create", 0);
  const edited = { ...value, items: [{ ...value.items[0], checked: true }] };
  await f.save(edited, "update", 1);
  assert.deepEqual(
    (await f.box().read("preDepartureChecklists", value.id)).value,
    edited,
  );
  assert.equal((await f.store.read(scope)).changes.length, 1);
  await assert.rejects(f.save(value, "update", 1), /LOCAL_CONFLICT/);
  f.c.permit = await permit({
    permissions: { preDepartureChecklists: ["read"] },
  });
  await assert.rejects(f.save(value, "update", 2), /ACTION_NOT_ALLOWED/);
});
test("lost checklist reply followed by item edit preserves server timestamps and syncs dependent edit", async () => {
  const f = await fixture();
  await f.save(value, "create", 0);
  await f.box().sync(transport(async () => ({ status: "retry" })));
  await f.save(
    { ...value, items: [{ ...value.items[0], checked: true }] },
    "update",
    1,
  );
  const calls = [];
  const result = await f.box().sync(
    transport(async (_s, op) => {
      calls.push(op);
      return {
        ...success(op),
        value: {
          ...op.value,
          created_at: "server",
          items: op.value.items.map((i) => ({ ...i, created_at: "server" })),
        },
      };
    }),
  );
  assert.equal(result.stopped, null);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].value.items[0].checked, true);
  assert.equal(calls[1].value.items[0].created_at, "server");
});
test("checklist merge preserves unrelated online edits and identifies real conflicts/deletion", () => {
  const before = value.items,
    next = [{ ...before[0], checked: true }],
    online = [{ ...before[0], label: "Online label", created_at: "server" }];
  const merged = mergeChecklistItems(before, next, online);
  assert.equal(merged.conflict, false);
  assert.equal(merged.value[0].label, "Online label");
  assert.equal(merged.value[0].checked, true);
  assert.equal(
    mergeChecklistItems(
      before,
      [{ ...before[0], label: "Local label" }],
      online,
    ).conflict,
    true,
  );
  assert.equal(mergeChecklistItems(before, next, []).conflict, true);
  assert.equal(mergeChecklistItems(before, [], online).conflict, true);
});
