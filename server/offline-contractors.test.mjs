import test from "node:test";
import assert from "node:assert/strict";
import {
  contractorsAdapter,
  contractorDeviceCopy,
} from "../yachy-app/src/offline/contractorsAdapter.ts";
import { OfflineOutbox } from "../yachy-app/src/offline/outbox.ts";
import { MemoryStore, scope, permit, epoch } from "./offline-fixtures.mjs";
const value = {
  id: "contractor-1",
  vessel_id: scope.vesselId,
  department: "BRIDGE",
  company_name: "Synthetic Marine",
  company_address: null,
  known_for: "Rigging",
  description: null,
  contacts: [
    { name: "Synthetic person", mobile: "", email: "synthetic@example.test" },
  ],
  created_by: scope.userId,
  created_at: "2026-11-09T00:00:00Z",
};
test("contractor offline edits coalesce and reject stale local versions", async () => {
  const store = new MemoryStore();
  const context = {
    scope,
    permit: await permit({
      permissions: { contractors: ["read", "create", "update"] },
    }),
    nowMs: epoch,
    highestObservedMs: 0,
    blocked: false,
  };
  const box = new OfflineOutbox({
    store,
    context: () => context,
    adapters: { contractors: contractorsAdapter },
  });
  await box.save({
    feature: "contractors",
    recordId: value.id,
    kind: "create",
    value,
    expectedLocalVersion: 0,
  });
  await box.save({
    feature: "contractors",
    recordId: value.id,
    kind: "update",
    value: { ...value, company_name: "Updated Marine" },
    expectedLocalVersion: 1,
  });
  assert.equal((await store.read(scope)).changes.length, 1);
  assert.equal(
    (await box.read("contractors", value.id)).value.company_name,
    "Updated Marine",
  );
  await assert.rejects(
    () =>
      box.save({
        feature: "contractors",
        recordId: value.id,
        kind: "update",
        value,
        expectedLocalVersion: 1,
      }),
    /LOCAL_CONFLICT/,
  );
});
test("contractor fields and contact payloads cannot expand the permitted record shape", () => {
  assert.equal(contractorsAdapter.validate(value), true);
  assert.equal(
    contractorsAdapter.validate({
      ...value,
      contacts: [{ ...value.contacts[0], secret: "bad" }],
    }),
    false,
  );
  assert.equal(
    contractorsAdapter.validate({ ...value, department: "ADMIN" }),
    false,
  );
  assert.equal(
    contractorsAdapter.authorize(
      scope,
      "create",
      { ...value, created_by: "another-user" },
      null,
    ),
    false,
  );
  assert.equal(
    contractorsAdapter.authorize(
      scope,
      "update",
      { ...value, vessel_id: "another-vessel" },
      { value },
    ),
    false,
  );
  assert.equal(
    contractorsAdapter.authorize(
      scope,
      "update",
      { ...value, created_by: "another-user" },
      { value },
    ),
    false,
  );
});
test("contractor conflict copy has its own identity and preserves contacts", () => {
  const copy = contractorDeviceCopy(value, "copy-id", scope.userId);
  assert.equal(contractorsAdapter.validate(copy), true);
  assert.equal(copy.id, "copy-id");
  assert.deepEqual(copy.contacts, value.contacts);
  assert.equal(contractorsAdapter.authorize(scope, "create", copy, null), true);
});
