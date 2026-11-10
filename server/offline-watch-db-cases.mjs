import assert from "node:assert/strict";
export async function runWatchChecks(t, { sql, run, user, vessel, device }) {
  const call = (op, suffix = "watch_keeping") =>
    JSON.parse(
      run(
        `SELECT sync_web_offline_${suffix}('${vessel}','${device}','${JSON.stringify(op).replaceAll("'", "''")}'::jsonb);`,
      ),
    );
  const slot = {
    crewId: user,
    crewName: "Synthetic crew",
    crewPosition: "Captain",
    startDate: "2026-11-10",
    endDate: "2026-11-11",
    startTimeStr: "22:00",
    endTimeStr: "02:00",
    durationHours: 4,
  };
  const v = {
    id: crypto.randomUUID(),
    vessel_id: vessel,
    watch_title: "Night watch",
    start_time: "22:00",
    start_location: null,
    destination: null,
    notes: "Before",
    for_date: "2026-11-10",
    slots: [slot],
    created_by: user,
    created_at: "local",
  };
  const op = {
    id: crypto.randomUUID(),
    recordId: v.id,
    feature: "watchKeeping",
    kind: "create",
    value: v,
    baseRevision: null,
  };
  let first, second;
  sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';
 INSERT INTO rest_entries(user_id,vessel_id,date,status,confirmed_by,confirmed_at) VALUES('${user}','${vessel}','2026-11-10','confirmed','${user}',now()),('${user}','${vessel}','2026-11-11','confirmed','${user}',now()),('${user}','${vessel}','2026-11-12','confirmed','${user}',now());`);
  await t.test(
    "watch: overnight publication and retry invalidate affected rest exactly once",
    () => {
      first = call(op);
      assert.equal(first.status, "applied");
      assert.deepEqual(call(op), first);
      assert.equal(
        sql(
          "SELECT count(*) FROM rest_entries WHERE status='needs_reconfirmation';",
        ),
        "2",
      );
      assert.equal(
        sql(
          "SELECT count(*) FROM rest_entries WHERE date='2026-11-12' AND status='confirmed';",
        ),
        "1",
      );
      assert.equal(
        sql(
          "SELECT count(*) FROM synthetic_notification_capture WHERE source_table='watch_keeping_timetables';",
        ),
        "1",
      );
      sql("UPDATE rest_entries SET status='confirmed';");
      call(op);
      assert.equal(
        sql(
          "SELECT count(*) FROM rest_entries WHERE status='needs_reconfirmation';",
        ),
        "0",
      );
    },
  );
  await t.test(
    "watch: revisioned update clears notes, reconfirms old and new days, refuses stale overwrite",
    () => {
      const edit = {
        ...op,
        id: crypto.randomUUID(),
        kind: "update",
        baseRevision: first.revision,
        value: {
          ...first.value,
          notes: null,
          slots: [{ ...slot, startDate: "2026-11-11", endDate: "2026-11-12" }],
        },
      };
      second = call(edit);
      assert.equal(second.status, "applied");
      assert.equal(second.value.notes, null);
      assert.equal(
        sql(
          "SELECT count(*) FROM rest_entries WHERE status='needs_reconfirmation';",
        ),
        "3",
      );
      assert.deepEqual(call(edit), second);
      assert.equal(
        call({ ...edit, id: crypto.randomUUID() }).status,
        "conflict",
      );
      assert.equal(
        sql(
          "SELECT count(*) FROM synthetic_notification_capture WHERE source_table='watch_keeping_timetables';",
        ),
        "2",
      );
    },
  );
  await t.test(
    "watch: shared crew cannot edit/create; private crew can only create schedules",
    () => {
      sql(`UPDATE users SET role='CREW' WHERE id='${user}';`);
      const context = () =>
        JSON.parse(
          run(`SELECT get_web_offline_context('${vessel}','${device}');`),
        );
      assert.deepEqual(context().permissions.watchKeeping, ["read"]);
      const fresh = {
        ...op,
        id: crypto.randomUUID(),
        recordId: crypto.randomUUID(),
      };
      fresh.value = { ...v, id: fresh.recordId };
      assert.throws(() => call(fresh), /row-level security/);
      assert.equal(
        call({
          ...op,
          id: crypto.randomUUID(),
          kind: "update",
          baseRevision: second.revision,
          value: { ...second.value, notes: "Forbidden" },
        }).status,
        "forbidden",
      );
      sql(`UPDATE vessels SET is_solo=true WHERE id='${vessel}';`);
      assert.deepEqual(context().permissions.watchKeeping, ["read", "create"]);
      assert.deepEqual(context().permissions.watchKeepingRules, ["read"]);
      assert.equal(call(fresh).status, "applied");
      sql(
        `UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';UPDATE vessels SET is_solo=false WHERE id='${vessel}';`,
      );
    },
  );
  await t.test(
    "watch: malformed intervals, nested fields and foreign crew cannot commit",
    () => {
      for (const bad of [
        { ...slot, endDate: "2026-02-31" },
        { ...slot, durationHours: 5 },
        { ...slot, startTimeStr: "99:00" },
        { ...slot, secret: true },
      ])
        assert.throws(
          () =>
            call({
              ...op,
              id: crypto.randomUUID(),
              kind: "update",
              baseRevision: second.revision,
              value: { ...second.value, slots: [bad] },
            }),
          /Invalid watch record/,
        );
      assert.equal(
        call({
          ...op,
          id: crypto.randomUUID(),
          kind: "update",
          baseRevision: second.revision,
          value: {
            ...second.value,
            slots: [{ ...slot, crewId: crypto.randomUUID() }],
          },
        }).status,
        "forbidden",
      );
    },
  );
  await t.test(
    "watch rules: singleton collision preserves first rules, edits and retries preserve identity",
    () => {
      const value = {
        id: crypto.randomUUID(),
        vessel_id: vessel,
        content: "Keep lookout",
        updated_by: user,
        updated_at: "local",
      };
      const rules = {
        id: crypto.randomUUID(),
        recordId: value.id,
        feature: "watchKeepingRules",
        kind: "create",
        value,
        baseRevision: null,
      };
      const saved = call(rules, "watch_rules");
      assert.equal(saved.status, "applied");
      assert.deepEqual(call(rules, "watch_rules"), saved);
      const otherId = crypto.randomUUID();
      assert.equal(
        call(
          {
            ...rules,
            id: crypto.randomUUID(),
            recordId: otherId,
            value: { ...value, id: otherId },
          },
          "watch_rules",
        ).status,
        "conflict",
      );
      const edit = {
        ...rules,
        id: crypto.randomUUID(),
        kind: "update",
        baseRevision: saved.revision,
        value: { ...saved.value, content: "" },
      };
      const cleared = call(edit, "watch_rules");
      assert.equal(cleared.value.content, "");
      assert.deepEqual(call(edit, "watch_rules"), cleared);
      assert.equal(
        call({ ...edit, id: crypto.randomUUID() }, "watch_rules").status,
        "conflict",
      );
      sql(`UPDATE users SET role='CREW' WHERE id='${user}';`);
      assert.equal(
        call(
          { ...edit, id: crypto.randomUUID(), baseRevision: cleared.revision },
          "watch_rules",
        ).status,
        "forbidden",
      );
      sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);
    },
  );
}
