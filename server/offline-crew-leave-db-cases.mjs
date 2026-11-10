import assert from "node:assert/strict";
export async function runCrewLeaveChecks(
  t,
  { sql, run, user, vessel, device },
) {
  const call = (op) =>
    JSON.parse(
      run(
        `SELECT sync_web_offline_crew_leave('${vessel}','${device}','${JSON.stringify(op).replaceAll("'", "''")}'::jsonb);`,
      ),
    );
  const value = {
    id: crypto.randomUUID(),
    vessel_id: vessel,
    crew_member_id: user,
    leave_type: "ANNUAL",
    start_date: "2026-11-10",
    end_date: "2026-11-12",
    notes: "Before",
    created_by: user,
    created_at: "local",
    updated_at: "local",
    crew_member_name_snapshot: "Untrusted",
    crew_member_position_snapshot: "Untrusted",
    crew_member_departments_snapshot: ["INTERIOR"],
  };
  const op = {
    id: crypto.randomUUID(),
    recordId: value.id,
    feature: "crewLeave",
    kind: "create",
    baseRevision: null,
    value,
  };
  let first, second;
  sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);
  await t.test(
    "crew leave: authoritative snapshots, retries and notification trigger commit once",
    () => {
      first = call(op);
      assert.equal(first.status, "applied");
      assert.deepEqual(call(op), first);
      assert.equal(first.value.crew_member_name_snapshot, "Synthetic crew");
      assert.equal(first.value.crew_member_position_snapshot, "Captain");
      assert.deepEqual(first.value.crew_member_departments_snapshot, [
        "BRIDGE",
      ]);
      assert.equal(
        sql(
          "SELECT count(*) FROM synthetic_notification_capture WHERE source_table='crew_leave';",
        ),
        "1",
      );
      const roster = JSON.parse(
        run(`SELECT read_web_offline_crew_roster('${vessel}','${device}');`),
      );
      assert.equal(roster.length, 1);
      assert.equal("email" in roster[0], false);
    },
  );
  await t.test(
    "crew leave: clear notes, change dates/type and preserve historical member details",
    () => {
      sql(`UPDATE users SET name='Renamed crew' WHERE id='${user}';`);
      const edit = {
        ...op,
        id: crypto.randomUUID(),
        kind: "update",
        baseRevision: first.revision,
        value: {
          ...first.value,
          notes: "",
          leave_type: "ROTATION",
          end_date: "2026-11-13",
        },
      };
      second = call(edit);
      assert.equal(second.status, "applied");
      assert.equal(second.value.notes, "");
      assert.equal(second.value.crew_member_name_snapshot, "Synthetic crew");
      assert.deepEqual(call(edit), second);
      assert.equal(
        call({ ...edit, id: crypto.randomUUID() }).status,
        "conflict",
      );
      assert.equal(
        sql(
          "SELECT count(*) FROM synthetic_notification_capture WHERE source_table='crew_leave';",
        ),
        "2",
      );
      sql(`UPDATE users SET name='Synthetic crew' WHERE id='${user}';`);
    },
  );
  await t.test(
    "crew leave: cross-vessel assignment and manager downgrade cannot write",
    () => {
      const other = crypto.randomUUID();
      sql(
        `INSERT INTO users(id,vessel_id,name) VALUES('${other}','${crypto.randomUUID()}','Other vessel');`,
      );
      const edit = {
        ...op,
        id: crypto.randomUUID(),
        kind: "update",
        baseRevision: second.revision,
        value: { ...second.value, crew_member_id: other },
      };
      assert.equal(call(edit).status, "forbidden");
      sql(`UPDATE users SET role='CREW' WHERE id='${user}';`);
      assert.equal(
        JSON.parse(
          run(`SELECT read_web_offline_crew_leave('${vessel}','${device}');`),
        ).length,
        1,
      );
      const ctx = JSON.parse(
        run(`SELECT get_web_offline_context('${vessel}','${device}');`),
      );
      assert.deepEqual(ctx.permissions.crewLeave, ["read"]);
      assert.equal(
        call({ ...edit, id: crypto.randomUUID(), value: second.value }).status,
        "forbidden",
      );
      assert.equal(
        sql(
          "SELECT count(*) FROM offline_private.record_receipts WHERE feature='crewLeave';",
        ),
        "2",
      );
      sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);
    },
  );
  await t.test(
    "crew leave: invalid dates and oversized notes cannot alter saved records",
    () => {
      for (const patch of [
        { end_date: "2026-01-01" },
        { notes: "x".repeat(1001) },
        { start_date: "2026-02-31" },
        { leave_type: "UNKNOWN" },
      ])
        assert.throws(() =>
          call({
            ...op,
            id: crypto.randomUUID(),
            kind: "update",
            baseRevision: second.revision,
            value: { ...second.value, ...patch },
          }),
        );
      assert.equal(sql("SELECT count(*) FROM crew_leave;"), "1");
    },
  );
}
