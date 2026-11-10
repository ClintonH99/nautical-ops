import test from "node:test";
import assert from "node:assert/strict";
import {
  maintenanceAdapter,
  maintenanceDeviceCopy,
} from "../yachy-app/src/offline/maintenanceAdapter.ts";
import { OfflineOutbox } from "../yachy-app/src/offline/outbox.ts";
import { MemoryStore, scope, permit, epoch } from "./offline-fixtures.mjs";
const value = {
  id: "maintenance-1",
  vessel_id: scope.vesselId,
  equipment: "Generator",
  serial_number: "test-serial",
  hours_of_service: "100",
  hours_at_next_service: "200",
  what_service_done: "Filter change",
  notes: "Before",
  service_done_by: "Synthetic crew",
  created_at: "2026-11-09T00:00:00Z",
  updated_at: "2026-11-09T00:00:00Z",
  port_starboard_na: "Port",
};
test("maintenance records retain service history, reject extra fields and vessel changes", () => {
  assert.equal(maintenanceAdapter.validate(value), true);
  assert.equal(
    maintenanceAdapter.validate({ ...value, service_done_by: "" }),
    false,
  );
  assert.equal(
    maintenanceAdapter.validate({ ...value, unexpected: "field" }),
    false,
  );
  assert.equal(
    maintenanceAdapter.authorizeRead(scope, { ...value, vessel_id: "other" }),
    false,
  );
  assert.equal(
    maintenanceAdapter.authorize(
      scope,
      "update",
      { ...value, id: "new" },
      { value },
    ),
    false,
  );
  assert.equal(
    maintenanceAdapter.validate(maintenanceDeviceCopy(value, "copy")),
    true,
  );
});
test("offline maintenance create/edit/clear and reopen preserve one final operation", async () => {
  const store = new MemoryStore(),
    ctx = {
      scope,
      permit: await permit({
        permissions: { maintenanceLogs: ["read", "create", "update"] },
      }),
      nowMs: epoch,
      highestObservedMs: 0,
      blocked: false,
    };
  const box = new OfflineOutbox({
    store,
    context: () => ctx,
    adapters: { maintenanceLogs: maintenanceAdapter },
  });
  await box.save({
    feature: "maintenanceLogs",
    recordId: value.id,
    kind: "create",
    value,
    expectedLocalVersion: 0,
  });
  await box.save({
    feature: "maintenanceLogs",
    recordId: value.id,
    kind: "update",
    value: { ...value, notes: null, serial_number: null },
    expectedLocalVersion: 1,
  });
  const reopened = new OfflineOutbox({
    store,
    context: () => ctx,
    adapters: { maintenanceLogs: maintenanceAdapter },
  });
  assert.equal(
    (await reopened.read("maintenanceLogs", value.id)).value.notes,
    null,
  );
  assert.equal(
    (await reopened.read("maintenanceLogs", value.id)).value.serial_number,
    null,
  );
  assert.equal((await store.read(scope)).changes.length, 1);
  await assert.rejects(
    () =>
      box.save({
        feature: "maintenanceLogs",
        recordId: value.id,
        kind: "update",
        value,
        expectedLocalVersion: 1,
      }),
    (error) => error.code === "LOCAL_CONFLICT",
  );
});
