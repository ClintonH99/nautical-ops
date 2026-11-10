import assert from "node:assert/strict";
export async function runChecklistChecks(
  t,
  { sql, run, user, vessel, device },
) {
  const call = (op) =>
    JSON.parse(
      run(
        `SELECT sync_web_offline_checklist('${vessel}','${device}','${JSON.stringify(op).replaceAll("'", "''")}'::jsonb);`,
      ),
    );
  const make = () => {
    const id = crypto.randomUUID();
    return {
      id: crypto.randomUUID(),
      recordId: id,
      feature: "preDepartureChecklists",
      kind: "create",
      baseRevision: null,
      value: {
        id,
        vessel_id: vessel,
        trip_id: null,
        department: null,
        title: "Departure",
        created_by: user,
        created_at: new Date().toISOString(),
        items: ["Fuel", "Safety"].map((label, sort_order) => ({
          id: crypto.randomUUID(),
          checklist_id: id,
          label,
          sort_order,
          checked: false,
          created_at: new Date().toISOString(),
        })),
      },
    };
  };
  sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);
  let first, second, op;
  await t.test(
    "checklists: parent and children commit once and edits replay safely",
    () => {
      op = make();
      first = call(op);
      assert.equal(first.status, "applied");
      assert.deepEqual(call(op), first);
      const value = structuredClone(first.value);
      value.title = "Ready";
      value.items[0].checked = true;
      value.items.push({
        ...value.items[0],
        id: crypto.randomUUID(),
        label: "Water",
        sort_order: 2,
        checked: false,
      });
      const edit = {
        ...op,
        id: crypto.randomUUID(),
        kind: "update",
        baseRevision: first.revision,
        value,
      };
      second = call(edit);
      assert.equal(second.status, "applied");
      assert.equal(second.value.items.length, 3);
      assert.deepEqual(call(edit), second);
      assert.equal(
        call({ ...edit, id: crypto.randomUUID() }).status,
        "conflict",
      );
      assert.equal(sql("SELECT count(*) FROM pre_departure_checklists;"), "1");
      assert.equal(
        sql("SELECT count(*) FROM pre_departure_checklist_items;"),
        "3",
      );
    },
  );
  await t.test(
    "checklists: changed child rejects a stale whole-checklist save",
    () => {
      sql(
        `UPDATE pre_departure_checklist_items SET label='Changed online' WHERE id='${second.value.items[0].id}';`,
      );
      assert.equal(
        call({
          ...op,
          id: crypto.randomUUID(),
          kind: "update",
          baseRevision: second.revision,
          value: second.value,
        }).status,
        "conflict",
      );
    },
  );
  await t.test(
    "checklists: crew can read but cannot write; inaccessible trip cannot be linked",
    () => {
      const missingTrip = make();
      missingTrip.value.trip_id = crypto.randomUUID();
      assert.equal(call(missingTrip).status, "conflict");
      sql(`UPDATE users SET role='CREW' WHERE id='${user}';`);
      assert.equal(
        JSON.parse(
          run(`SELECT read_web_offline_checklists('${vessel}','${device}');`),
        ).length,
        1,
      );
      assert.equal(call(make()).status, "forbidden");
      const ctx = JSON.parse(
        run(`SELECT get_web_offline_context('${vessel}','${device}');`),
      );
      assert.deepEqual(ctx.permissions.preDepartureChecklists, ["read"]);
      sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);
    },
  );
  await t.test(
    "checklists: a colliding child rolls back its new parent and receipt",
    () => {
      const collision = make();
      collision.value.items[0].id = second.value.items[0].id;
      assert.equal(call(collision).status, "conflict");
      assert.equal(sql("SELECT count(*) FROM pre_departure_checklists;"), "1");
      assert.equal(
        sql(
          "SELECT count(*) FROM offline_private.record_receipts WHERE feature='preDepartureChecklists';",
        ),
        "2",
      );
    },
  );
  await t.test(
    "checklists: denied child update rolls back permitted parent changes",
    () => {
      const current = JSON.parse(
        run(`SELECT read_web_offline_checklists('${vessel}','${device}');`),
      )[0];
      sql(
        'DROP POLICY "Managers update checklist items" ON pre_departure_checklist_items;',
      );
      const edit = {
        ...op,
        id: crypto.randomUUID(),
        kind: "update",
        baseRevision: current.revision,
        value: { ...current.value, title: "Must roll back" },
      };
      assert.equal(call(edit).status, "forbidden");
      assert.equal(
        sql(
          `SELECT title FROM pre_departure_checklists WHERE id='${op.recordId}';`,
        ),
        "Ready",
      );
      assert.equal(
        sql(
          "SELECT count(*) FROM offline_private.record_receipts WHERE feature='preDepartureChecklists';",
        ),
        "2",
      );
    },
  );
}
