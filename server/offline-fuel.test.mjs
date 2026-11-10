import test from "node:test";
import assert from "node:assert/strict";
import { fuelAdapter } from "../yachy-app/src/offline/fuelAdapter.ts";
import { fuelSnapshot } from "../yachy-app/src/offline/fuelSnapshot.ts";
import { OfflineOutbox } from "../yachy-app/src/offline/outbox.ts";
import {
  MemoryStore,
  scope,
  permit,
  epoch,
  transport,
  success,
} from "./offline-fixtures.mjs";
const fields = {
  location_of_refueling: "A",
  log_date: "2026-11-10",
  log_time: "10:00",
  amount_of_fuel: 10,
  price_per_gallon: 2,
  total_price: 20,
  volume_unit: "LITRES",
  price_volume_unit: "LITRES",
  currency_code: "USD",
  comment: "",
  effective_at: "2026-11-10T10:00:00Z",
  utc_offset_minutes: 0,
};
const value = {
  id: "fuel-1",
  vessel_id: scope.vesselId,
  source_id: null,
  fields,
  entries: [],
  server: {},
  amendment_reason: "",
};
async function fixture() {
  const store = new MemoryStore(),
    ctx = {
      scope,
      permit: await permit({
        permissions: {
          fuelLogs: ["read", "create", "update"],
          fuelEntries: ["read", "create"],
          fuelTransfers: ["read", "create"],
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
      fuelLogs: fuelAdapter("fuelLogs"),
      fuelEntries: fuelAdapter("fuelEntries"),
    },
  });
  await box.replaceSnapshot("fuelLogs", []);
  return { box, store, ctx };
}
test("fuel creates and edits survive reopening, replay once and preserve canonical aliases", async () => {
  const { box, store, ctx } = await fixture();
  await box.save({
    feature: "fuelLogs",
    recordId: value.id,
    value,
    kind: "create",
    expectedLocalVersion: 0,
  });
  await box.save({
    feature: "fuelLogs",
    recordId: value.id,
    value: { ...value, fields: { ...fields, comment: "At sea" } },
    kind: "update",
    expectedLocalVersion: 1,
  });
  const reopened = new OfflineOutbox({
    store,
    context: () => ctx,
    adapters: { fuelLogs: fuelAdapter("fuelLogs") },
  });
  assert.equal(
    (await reopened.list("fuelLogs"))[0].value.fields.comment,
    "At sea",
  );
  let n = 0;
  await reopened.sync(
    transport(async (_, op) => {
      n++;
      return {
        ...success(op),
        value: {
          ...op.value,
          source_id: "actual-server-id",
          server: { inventory_revision: 1 },
        },
      };
    }),
  );
  assert.equal(n, 1);
  assert.equal(
    (await reopened.list("fuelLogs"))[0].value.source_id,
    "actual-server-id",
  );
  assert.equal((await store.read(scope)).changes.length, 0);
});
test("fuel rejects forged fields, negative values and unauthorized adjustments; legacy unknown time remains readable", () => {
  const a = fuelAdapter("fuelLogs");
  assert.ok(a.validate(value));
  for (const f of [
    { ...fields, amount_of_fuel: -1 },
    { ...fields, arbitrary: "rpc" },
    { ...fields, utc_offset_minutes: 900 },
  ])
    assert.equal(a.validate({ ...value, fields: f }), false);
  assert.ok(
    a.validate({
      ...value,
      source_id: "old",
      fields: {
        ...fields,
        effective_at: null,
        utc_offset_minutes: null,
        volume_unit: null,
        price_volume_unit: null,
        price_per_gallon: 0,
      },
    }),
  );
  assert.equal(
    fuelAdapter("fuelEntries").authorize(
      scope,
      "create",
      { ...value, fields: { operation_type: "ADJUSTMENT" } },
      null,
    ),
    false,
  );
});
test("confirmed snapshot respects absolute reset, delta ordering, voids, archival and unknown tanks", () => {
  const at = "2026-11-10T10:00:00Z";
  const operation = (id, kind, amount, time, extra = {}) => ({
    id,
    operation_type: kind,
    effective_at: time,
    effective_order: 0,
    recorded_sequence: Number(id),
    postings: [
      {
        fuel_tank_id: "t1",
        posting_mode: kind === "SOUNDING" ? "ABSOLUTE" : "DELTA",
        amount_litres: amount,
      },
    ],
    ...extra,
  });
  const c = {
    vessel_id: "v",
    downloaded_at: at,
    setup: {
      settings: {
        volume_unit: "LITRES",
        inventory_activated_at: "2026-11-01T00:00:00Z",
      },
    },
    tanks: [
      {
        id: "t1",
        name: "Port",
        created_at: "2026-11-01T00:00:00Z",
        capacity_litres: 1000,
        archived_at: null,
      },
    ],
    operations: [
      operation("1", "SOUNDING", 100, "2026-11-09T10:00:00Z"),
      operation("2", "CONSUMPTION", -10, "2026-11-09T11:00:00Z"),
      operation("3", "CONSUMPTION", -50, at, { voided: true }),
      operation("4", "SOUNDING", 75, "2026-11-10T11:00:00Z"),
    ],
  };
  assert.equal(fuelSnapshot(c, at).total_balance_litres, 90);
  assert.equal(
    fuelSnapshot(c, "2026-11-10T12:00:00Z").total_balance_litres,
    75,
  );
  assert.equal(
    fuelSnapshot(
      { ...c, tanks: [...c.tanks, { ...c.tanks[0], id: "unknown" }] },
      at,
    ).total_balance_litres,
    null,
  );
  assert.equal(
    fuelSnapshot({ ...c, tanks: [{ ...c.tanks[0], archived_at: at }] }, at)
      .tanks.length,
    0,
  );
});

test("fuel: an edit made after a lost acknowledgement waits for the original receipt and rebases server IDs", async () => {
  const { box, store } = await fixture();
  await box.save({
    feature: "fuelLogs",
    recordId: value.id,
    value,
    kind: "create",
    expectedLocalVersion: 0,
  });
  let original;
  await box.sync(
    transport(async (_, op) => {
      original = structuredClone(op);
      return { status: "retry" };
    }),
  );
  await box.save({
    feature: "fuelLogs",
    recordId: value.id,
    value: {
      ...value,
      fields: { ...fields, comment: "Correction after retry" },
    },
    kind: "update",
    expectedLocalVersion: 1,
  });
  assert.equal((await store.read(scope)).changes.length, 2);
  const sent = [];
  await box.sync(
    transport(async (_, op) => {
      sent.push(structuredClone(op));
      return {
        ...success(op),
        value: {
          ...op.value,
          source_id: "server-fuel",
          server: { inventory_revision: 1 },
        },
      };
    }),
  );
  assert.deepEqual(sent[0], original);
  assert.equal(sent[1].kind, "update");
  assert.equal(sent[1].value.source_id, "server-fuel");
  assert.equal(sent[1].value.fields.comment, "Correction after retry");
  assert.equal((await store.read(scope)).changes.length, 0);
});
test("fuel: server rejection preserves the device receipt and stops replay", async () => {
  const { box, store } = await fixture();
  await box.save({
    feature: "fuelLogs",
    recordId: value.id,
    value,
    kind: "create",
    expectedLocalVersion: 0,
  });
  await box.sync(transport(async () => ({ status: "conflict" })));
  const state = await store.read(scope);
  assert.equal(state.changes[0].state, "conflict");
  assert.deepEqual((await box.list("fuelLogs"))[0].value, value);
});
