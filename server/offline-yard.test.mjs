import test from "node:test";
import assert from "node:assert/strict";
import {
  yardJobsAdapter,
  yardJobDeviceCopy,
} from "../yachy-app/src/offline/yardJobsAdapter.ts";
import { OfflineOutbox } from "../yachy-app/src/offline/outbox.ts";
import { MemoryStore, scope, permit, epoch } from "./offline-fixtures.mjs";
const value = {
  id: "yard-1",
  vessel_id: scope.vesselId,
  job_title: "Check passerelle",
  job_description: null,
  yard_location: null,
  contractor_company_name: null,
  contact_details: null,
  done_by_date: null,
  status: "NOT_STARTED",
  completed_by: null,
  completed_at: null,
  completed_by_name: null,
  created_by: scope.userId,
  created_at: "2026-11-09T00:00:00Z",
  updated_at: "2026-11-09T00:00:00Z",
  department: "BRIDGE",
  priority: "GREEN",
  trip_id: null,
  defect_details: null,
  defect_location: null,
  equipment_serial: null,
  start_date: "2026-11-10",
  end_date: "2026-11-12",
};
const done = {
  ...value,
  status: "COMPLETED",
  completed_by: scope.userId,
  completed_at: "2026-11-09T01:00:00Z",
  completed_by_name: "Synthetic crew",
};
async function context(captain = false) {
  return {
    scope,
    permit: await permit({
      permissions: {
        yardJobs: ["read", "create", "update"],
        shipyardRecords: captain ? ["read", "update"] : ["read"],
      },
    }),
    nowMs: epoch,
    highestObservedMs: 0,
    blocked: false,
  };
}
test("yard dates, identities and Captain-only completed-record changes", async () => {
  assert.equal(yardJobsAdapter.validate(value), true);
  assert.equal(
    yardJobsAdapter.validate({ ...value, start_date: "2026-02-30" }),
    false,
  );
  assert.equal(
    yardJobsAdapter.validate({ ...value, end_date: "2026-11-01" }),
    false,
  );
  assert.equal(
    yardJobsAdapter.authorize(
      scope,
      "create",
      { ...done, completed_by: "other" },
      null,
    ),
    false,
  );
  assert.equal(
    yardJobsAdapter.authorize(
      scope,
      "update",
      { ...done, job_title: "Edited" },
      { value: done },
      await context(),
    ),
    false,
  );
  assert.equal(
    yardJobsAdapter.authorize(
      scope,
      "update",
      { ...done, job_title: "Edited" },
      { value: done },
      await context(true),
    ),
    true,
  );
  assert.equal(
    yardJobsAdapter.authorize(
      scope,
      "update",
      value,
      { value: done },
      await context(true),
    ),
    false,
  );
  assert.equal(
    yardJobsAdapter.authorizeRead(scope, { ...value, vessel_id: "other" }),
    false,
  );
  assert.equal(
    yardJobDeviceCopy(done, "copy", scope.userId).status,
    "NOT_STARTED",
  );
});
test("create and complete offline survive reopening and upload once", async () => {
  const store = new MemoryStore(),
    ctx = await context();
  const box = new OfflineOutbox({
    store,
    context: () => ctx,
    adapters: { yardJobs: yardJobsAdapter },
  });
  await box.save({
    feature: "yardJobs",
    recordId: value.id,
    kind: "create",
    value,
    expectedLocalVersion: 0,
  });
  await box.save({
    feature: "yardJobs",
    recordId: value.id,
    kind: "update",
    value: done,
    expectedLocalVersion: 1,
  });
  const reopened = new OfflineOutbox({
    store,
    context: () => ctx,
    adapters: { yardJobs: yardJobsAdapter },
  });
  assert.equal(
    (await reopened.read("yardJobs", value.id)).value.status,
    "COMPLETED",
  );
  await assert.rejects(
    () =>
      reopened.save({
        feature: "yardJobs",
        recordId: value.id,
        kind: "update",
        value: { ...done, job_title: "Unauthorized edit" },
        expectedLocalVersion: 2,
      }),
    /ACTION_NOT_ALLOWED/,
  );
  let count = 0;
  await reopened.sync({
    protocol: "offline-mutation-v1",
    revalidate: async () => true,
    apply: async (s, op) => {
      count++;
      return {
        status: "applied",
        operationId: op.id,
        recordId: op.recordId,
        value: op.value,
        revision: "r1",
      };
    },
  });
  assert.equal(count, 1);
  assert.equal((await store.read(scope)).changes.length, 0);
});
