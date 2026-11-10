import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  note,
  scope,
  transport,
  notesAdapter,
} from "./offline-fixtures.mjs";
import { describeOfflineRecord } from "../yachy-app/src/offline/recordDescription.ts";
const adapter = {
  ...notesAdapter,
  validate: (v) =>
    typeof v.id === "string" &&
    notesAdapter.validate(
      Object.fromEntries(Object.entries(v).filter(([k]) => k !== "id")),
    ),
};
async function conflict() {
  const f = await fixture({}, adapter),
    value = { ...note, id: "record" };
  await f.box.cache("notes", "record", value, "base");
  await f.box.save({
    feature: "notes",
    recordId: "record",
    kind: "update",
    value: { ...value, content: "Device edit" },
    expectedLocalVersion: 1,
  });
  await f.box.sync(transport(async () => ({ status: "conflict" })));
  const state = await f.store.read(scope);
  return {
    ...f,
    input: {
      operationId: state.changes[0].id,
      expectedLocalVersion: 2,
      online: { value: { ...value, content: "Online edit" }, revision: "new" },
    },
  };
}
test("using reviewed online row atomically archives every device edit instead of discarding or uploading it", async () => {
  const { box, store, input } = await conflict();
  await box.useOnlineVersion(input);
  const state = await store.read(scope);
  assert.equal(state.changes.length, 0);
  assert.equal(state.recoveryCopies.length, 1);
  assert.equal(state.recoveryCopies[0].value.content, "Device edit");
  assert.equal(state.recoveryCopies[0].changes[0].value.content, "Device edit");
  assert.equal(
    (await box.read("notes", "record")).value.content,
    "Online edit",
  );
  await assert.rejects(box.useOnlineVersion(input), /CONFLICT_CHANGED/);
});
test("failed durable resolution preserves pending operation and original device record", async () => {
  const { box, store, input } = await conflict();
  store.failWrites = true;
  await assert.rejects(box.useOnlineVersion(input));
  const state = await store.read(scope);
  assert.equal(state.changes.length, 1);
  assert.equal(state.recoveryCopies, undefined);
});
test("another tab editing or switching ownership cannot be overwritten by stale review", async () => {
  const { box, store, input } = await conflict();
  await assert.rejects(
    box.useOnlineVersion({ ...input, expectedLocalVersion: 1 }),
    /LOCAL_CONFLICT/,
  );
  await assert.rejects(
    box.useOnlineVersion({
      ...input,
      online: {
        ...input.online,
        value: { ...input.online.value, ownerId: "other" },
      },
    }),
    /ACTION_NOT_ALLOWED/,
  );
  assert.equal((await store.read(scope)).changes.length, 1);
});
test("expiry retains conflicted work and blocks resolution", async () => {
  const { box, context, store, input } = await conflict();
  context.nowMs += 8 * 86400000;
  await assert.rejects(box.useOnlineVersion(input));
  assert.equal((await store.read(scope)).changes.length, 1);
});
test("recovery text shows editable details without internal IDs or embedded signatures", () => {
  const result = describeOfflineRecord({
    id: "private-id",
    vessel_id: "vessel",
    title: "Engine watch",
    items: [{ id: "item", label: "Inspect bilges", checked: true }],
    reviewer_signature_image: "data:image/png;base64,SECRET",
  });
  assert.match(result, /Inspect bilges/);
  assert.match(result, /Yes/);
  assert.doesNotMatch(result, /private-id|SECRET|vessel_id/);
});
