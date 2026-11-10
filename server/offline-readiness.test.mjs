import test from "node:test";
import assert from "node:assert/strict";
import {
  offlineRecordsReady,
  isOfflineStorageFailure,
} from "../yachy-app/src/offline/readiness.ts";
import { emptyPartition } from "../yachy-app/src/offline/outbox.ts";
const ready = () => ({
  ...emptyPartition(),
  tripColors: null,
  shipyardFolders: {},
  crewRoster: [],
  restSignature: false,
  seaMileContext: {},
  documentContext: {},
  fuelContext: {},
  snapshots: { notes: true, fuelLogs: true },
});
test("offline download readiness requires every authorized snapshot and supporting context", () => {
  const permissions = { notes: ["read"], fuelLogs: ["read"], fuelEntries: [] },
    features = Object.keys(permissions);
  assert.equal(offlineRecordsReady(ready(), permissions, features), true);
  for (const key of [
    "tripColors",
    "shipyardFolders",
    "crewRoster",
    "restSignature",
    "seaMileContext",
    "documentContext",
    "fuelContext",
  ]) {
    const s = ready();
    delete s[key];
    assert.equal(offlineRecordsReady(s, permissions, features), false, key);
  }
  const s = ready();
  delete s.snapshots.fuelLogs;
  assert.equal(offlineRecordsReady(s, permissions, features), false);
  s.snapshots.fuelLogs = true;
  assert.equal(offlineRecordsReady(s, permissions, features), true);
});
test("device storage errors are distinguished from connectivity or permission failures", () => {
  for (const error of [
    { code: "LOCAL_SAVE_FAILED" },
    { code: "LOCAL_STORAGE_UNAVAILABLE" },
    { name: "QuotaExceededError" },
  ])
    assert.equal(isOfflineStorageFailure(error), true);
  for (const error of [
    null,
    {},
    new Error("network"),
    { code: "ACTION_NOT_ALLOWED" },
  ])
    assert.equal(isOfflineStorageFailure(error), false);
});
