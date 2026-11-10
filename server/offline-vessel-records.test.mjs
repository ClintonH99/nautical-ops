import test from "node:test";
import assert from "node:assert/strict";
import {
  vesselRecordAdapter,
  vesselRecordDeviceCopy,
} from "../yachy-app/src/offline/vesselRecordAdapter.ts";
import { OfflineOutbox } from "../yachy-app/src/offline/outbox.ts";
import { MemoryStore, scope, permit, epoch } from "./offline-fixtures.mjs";
const common = {
  id: "record-1",
  vessel_id: scope.vesselId,
  created_at: "2026-11-09T00:00:00Z",
};
const log = {
  ...common,
  log_date: "2026-11-09",
  log_time: "12:00",
  created_by_name: "Synthetic crew",
};
export const vesselRecordValues = {
  pumpOutLogs: {
    ...log,
    discharge_type: "PUMPOUT_SERVICE",
    pumpout_service_name: "Synthetic service",
    location: "Test dock",
    amount_in_gallons: 100,
    description: "Before",
  },
  generalWasteLogs: {
    ...log,
    position_location: "Test dock",
    description_of_garbage: "Before",
    weight: 10,
    weight_unit: "kgs",
  },
  uniforms: {
    ...common,
    label: "Test uniform",
    department: "INTERIOR",
    entries: [
      { amount: "2", size: "M", color: "Navy", gender: "", dayNight: "Day" },
    ],
    created_by: scope.userId,
    updated_at: common.created_at,
  },
};
for (const [feature, value] of Object.entries(vesselRecordValues)) {
  const adapter = vesselRecordAdapter(feature);
  test(
    feature + ": invalid values and cross-vessel/author edits are rejected",
    () => {
      assert.equal(adapter.validate(value), true);
      assert.equal(adapter.validate({ ...value, extra: true }), false);
      assert.equal(
        adapter.authorizeRead(scope, { ...value, vessel_id: "other" }),
        false,
      );
      const author = feature === "uniforms" ? "created_by" : "created_by_name";
      assert.equal(
        adapter.authorize(
          scope,
          "update",
          { ...value, [author]: "other" },
          { value },
        ),
        false,
      );
      const invalid =
        feature === "uniforms"
          ? [
              { entries: [{ amount: "2" }] },
              { entries: [{ ...value.entries[0], extra: true }] },
            ]
          : [
              { log_date: "2026-02-30" },
              { log_time: "25:00" },
              feature === "pumpOutLogs"
                ? { amount_in_gallons: -1 }
                : { weight: -1 },
            ];
      for (const patch of invalid)
        assert.equal(adapter.validate({ ...value, ...patch }), false);
      assert.equal(
        adapter.validate(
          vesselRecordDeviceCopy(
            feature,
            value,
            "copy",
            scope.userId,
            "Synthetic crew",
          ),
        ),
        true,
      );
    },
  );
  test(
    feature +
      ": create/edit/clear survives reopening as one operation and preserves concurrent edits",
    async () => {
      const store = new MemoryStore(),
        context = {
          scope,
          permit: await permit({
            permissions: { [feature]: ["read", "create", "update"] },
          }),
          nowMs: epoch,
          highestObservedMs: 0,
          blocked: false,
        };
      const box = () =>
        new OfflineOutbox({
          store,
          context: () => context,
          adapters: { [feature]: adapter },
        });
      await box().save({
        feature,
        recordId: value.id,
        kind: "create",
        value,
        expectedLocalVersion: 0,
      });
      const patch =
        feature === "uniforms"
          ? { entries: [] }
          : feature === "pumpOutLogs"
            ? { description: null }
            : { weight: null };
      const edited = { ...value, ...patch };
      await box().save({
        feature,
        recordId: value.id,
        kind: "update",
        value: edited,
        expectedLocalVersion: 1,
      });
      assert.deepEqual((await box().read(feature, value.id)).value, edited);
      assert.equal((await store.read(scope)).changes.length, 1);
      await assert.rejects(
        box().save({
          feature,
          recordId: value.id,
          kind: "update",
          value,
          expectedLocalVersion: 1,
        }),
        (error) => error.code === "LOCAL_CONFLICT",
      );
    },
  );
}
