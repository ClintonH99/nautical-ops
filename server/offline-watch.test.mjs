import test from "node:test";
import assert from "node:assert/strict";
import {
  watchKeepingAdapter,
  watchRulesAdapter,
  validWatchSlots,
} from "../yachy-app/src/offline/watchKeepingAdapter.ts";
import { OfflineOutbox } from "../yachy-app/src/offline/outbox.ts";
import { MemoryStore, scope, permit, epoch } from "./offline-fixtures.mjs";
const slot = {
  crewId: scope.userId,
  crewName: "Test",
  startDate: "2026-11-10",
  endDate: "2026-11-11",
  startTimeStr: "22:00",
  endTimeStr: "02:00",
  durationHours: 4,
};
const value = {
  id: "watch-1",
  vessel_id: scope.vesselId,
  watch_title: "Night watch",
  start_time: "22:00",
  start_location: null,
  destination: null,
  notes: "Before",
  for_date: "2026-11-10",
  slots: [slot],
  created_by: scope.userId,
  created_at: "local",
};
test("watch slot validation handles dated midnight intervals and legacy undated rows", () => {
  assert.equal(watchKeepingAdapter.validate(value), true);
  const { startDate, endDate, ...legacy } = slot;
  assert.equal(validWatchSlots([legacy]), true);
  for (const bad of [
    { ...slot, startDate: "2026-02-31" },
    { ...slot, durationHours: 5 },
    { ...slot, other: true },
    { ...slot, endTimeStr: "24:60" },
    { ...slot, startDate: undefined },
    null,
  ])
    assert.equal(validWatchSlots([bad]), false);
  assert.equal(validWatchSlots([{ ...slot, durationHours: 4.01 }]), true);
  assert.equal(validWatchSlots([]), false);
  assert.equal(
    watchKeepingAdapter.authorizeRead(scope, { ...value, vessel_id: "other" }),
    false,
  );
});
test("watch offline edit survives reopen and preserves assigned dates without duplicate publication", async () => {
  const store = new MemoryStore(),
    ctx = {
      scope,
      permit: await permit({
        permissions: { watchKeeping: ["read", "create", "update"] },
      }),
      nowMs: epoch,
      highestObservedMs: epoch,
      blocked: false,
    };
  const box = () =>
    new OfflineOutbox({
      store,
      context: () => ctx,
      adapters: { watchKeeping: watchKeepingAdapter },
    });
  const save = (v, kind, version) =>
    box().save({
      feature: "watchKeeping",
      recordId: value.id,
      kind,
      value: v,
      expectedLocalVersion: version,
    });
  await save(value, "create", 0);
  await save(
    { ...value, notes: null, watch_title: "Updated watch" },
    "update",
    1,
  );
  assert.equal((await box().read("watchKeeping", value.id)).value.notes, null);
  assert.equal((await store.read(scope)).changes.length, 1);
  await assert.rejects(
    save(value, "update", 1),
    (error) => error.code === "LOCAL_CONFLICT",
  );
  ctx.permit = await permit({
    permissions: { watchKeeping: ["read", "create"] },
  });
  await assert.rejects(save(value, "update", 2), /ACTION_NOT_ALLOWED/);
});
test("watch rules empty text is a valid explicit clearing; authority and identity stay scoped", () => {
  const v = {
    id: "rules",
    vessel_id: scope.vesselId,
    content: "",
    updated_by: scope.userId,
    updated_at: "local",
  };
  assert.equal(watchRulesAdapter.validate(v), true);
  assert.equal(watchRulesAdapter.validate({ ...v, secret: true }), false);
  assert.equal(
    watchRulesAdapter.authorize(
      scope,
      "create",
      { ...v, updated_by: "other" },
      null,
    ),
    false,
  );
  assert.equal(
    watchRulesAdapter.authorize(
      scope,
      "update",
      { ...v, id: "other" },
      { value: v },
    ),
    false,
  );
});
