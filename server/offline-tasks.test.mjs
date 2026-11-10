import test from "node:test";
import assert from "node:assert/strict";
import {
  tasksAdapter,
  taskDeviceCopy,
} from "../yachy-app/src/offline/tasksAdapter.ts";
import { OfflineOutbox } from "../yachy-app/src/offline/outbox.ts";
import { MemoryStore, scope, permit, epoch } from "./offline-fixtures.mjs";
const value = {
  id: "task-1",
  vessel_id: scope.vesselId,
  category: "DAILY",
  department: "INTERIOR",
  title: "Check lines",
  notes: null,
  done_by_date: null,
  recurring: null,
  status: "NOT_STARTED",
  created_by: scope.userId,
  created_at: "2026-11-09T00:00:00Z",
  updated_at: "2026-11-09T00:00:00Z",
  completed_by: null,
  completed_at: null,
  completed_by_name: null,
};
async function setup() {
  const store = new MemoryStore();
  const context = {
    scope,
    permit: await permit({
      permissions: { tasks: ["read", "create", "update"] },
    }),
    nowMs: epoch,
    highestObservedMs: 0,
    blocked: false,
  };
  return {
    store,
    box: new OfflineOutbox({
      store,
      context: () => context,
      adapters: { tasks: tasksAdapter },
    }),
  };
}
test("new offline task can be edited and completed before the first sync", async () => {
  const { store, box } = await setup();
  await box.save({
    feature: "tasks",
    recordId: value.id,
    kind: "create",
    value,
    expectedLocalVersion: 0,
  });
  const completed = {
    ...value,
    status: "COMPLETED",
    completed_by: scope.userId,
    completed_at: "2026-11-09T01:00:00Z",
    completed_by_name: "Synthetic crew",
  };
  await box.save({
    feature: "tasks",
    recordId: value.id,
    kind: "update",
    value: completed,
    expectedLocalVersion: 1,
  });
  const pending = (await store.read(scope)).changes;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, "create");
  assert.equal(pending[0].value.status, "COMPLETED");
  assert.equal(
    tasksAdapter.authorize(scope, "create", pending[0].value, null),
    true,
  );
});
test("stale screen cannot complete a task changed by another local tab", async () => {
  const { box } = await setup();
  await box.cache("tasks", value.id, value, "revision-1");
  await box.save({
    feature: "tasks",
    recordId: value.id,
    kind: "update",
    value: { ...value, title: "New title" },
    expectedLocalVersion: 1,
  });
  await assert.rejects(
    () =>
      box.save({
        feature: "tasks",
        recordId: value.id,
        kind: "update",
        value,
        expectedLocalVersion: 1,
      }),
    /LOCAL_CONFLICT/,
  );
});
test("offline task permissions reject another vessel, creator, completion actor and unmarking", () => {
  const previous = { value };
  assert.equal(
    tasksAdapter.authorize(
      scope,
      "create",
      { ...value, vessel_id: "other" },
      null,
    ),
    false,
  );
  assert.equal(
    tasksAdapter.authorize(
      scope,
      "update",
      { ...value, created_by: "other" },
      previous,
    ),
    false,
  );
  const completed = {
    ...value,
    status: "COMPLETED",
    completed_by: "other",
    completed_at: "now",
    completed_by_name: "Other",
  };
  assert.equal(
    tasksAdapter.authorize(scope, "update", completed, previous),
    false,
  );
  assert.equal(
    tasksAdapter.authorize(scope, "update", value, {
      value: { ...completed, completed_by: scope.userId },
    }),
    false,
  );
});
test("active recurring tasks require a valid category frequency and deadline", () => {
  assert.equal(
    tasksAdapter.validate({ ...value, category: "WEEKLY", recurring: null }),
    false,
  );
  assert.equal(
    tasksAdapter.validate({
      ...value,
      category: "WEEKLY",
      recurring: "30_DAYS",
      done_by_date: "2026-11-16",
    }),
    false,
  );
  assert.equal(
    tasksAdapter.validate({
      ...value,
      category: "WEEKLY",
      recurring: "7_DAYS",
      done_by_date: "2026-11-16",
    }),
    true,
  );
  assert.equal(
    tasksAdapter.validate({ ...value, unknown: "hidden-field" }),
    false,
  );
});
test("a conflicting completed task copy becomes an active task without forged completion", () => {
  const copy = taskDeviceCopy(
    { ...value, status: "COMPLETED", category: "MONTHLY", recurring: null },
    "copy-id",
    scope.userId,
  );
  assert.equal(copy.status, "NOT_STARTED");
  assert.equal(copy.completed_by, null);
  assert.equal(tasksAdapter.validate(copy), true);
  assert.equal(tasksAdapter.authorize(scope, "create", copy, null), true);
});
