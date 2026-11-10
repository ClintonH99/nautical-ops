import assert from "node:assert/strict";
export async function runRestChecks(t, { sql, run, user, vessel, device }) {
  const call = (op) =>
    JSON.parse(
      run(
        `SELECT sync_web_offline_rest_entries('${vessel}','${device}','${JSON.stringify(op).replaceAll("'", "''")}'::jsonb);`,
      ),
    );
  const watches = () =>
    JSON.parse(run(`SELECT web_offline_watch_versions('${vessel}');`));
  const value = {
    id: crypto.randomUUID(),
    user_id: user,
    vessel_id: vessel,
    date: "2026-11-01",
    rest_periods: [{ start: "22:00", end: "02:00" }],
    work_start: "08:00",
    work_end: "17:00",
    lunch_start: null,
    lunch_end: null,
    comment: "Honest short rest",
    status: "draft",
    confirmed_by: null,
    confirmed_at: null,
    created_at: "local",
    updated_at: "local",
    watch_versions: {},
  };
  const op = {
    id: crypto.randomUUID(),
    recordId: value.id,
    feature: "restEntries",
    kind: "create",
    value,
    baseRevision: null,
  };
  const edit = (saved, patch) => ({
    ...op,
    id: crypto.randomUUID(),
    kind: "update",
    value: { ...saved.value, ...patch },
    baseRevision: saved.revision,
  });
  let saved, confirmed;
  await t.test(
    "rest: truthful short hours persist once; own draft reads are isolated",
    () => {
      sql(`UPDATE users SET role='CREW' WHERE id='${user}';`);
      saved = call(op);
      assert.equal(saved.status, "applied");
      assert.deepEqual(call(op), saved);
      assert.equal(saved.value.rest_periods[0].end, "02:00");
      const rows = JSON.parse(
        run(`SELECT read_web_offline_rest_entries('${vessel}','${device}');`),
      );
      assert.ok(rows.every((r) => r.value.user_id === user));
      assert.throws(
        () =>
          run(`SELECT read_web_offline_rest_review('${vessel}','${device}');`),
        /Captain review required/,
      );
      const duplicate = {
        ...op,
        id: crypto.randomUUID(),
        recordId: crypto.randomUUID(),
      };
      duplicate.value = { ...value, id: duplicate.recordId };
      assert.equal(call(duplicate).status, "conflict");
    },
  );
  await t.test(
    "rest: confirmed and pending locks, Captain-only signoff and server-stamped identity",
    () => {
      assert.equal(
        call(
          edit(saved, {
            status: "confirmed",
            confirmed_by: user,
            confirmed_at: "1900-01-01",
            watch_versions: watches(),
          }),
        ).status,
        "forbidden",
      );
      const pending = call(edit(saved, { status: "pending_confirmation" }));
      assert.equal(pending.status, "applied");
      assert.equal(
        call(edit(pending, { status: "draft" })).status,
        "forbidden",
      );
      sql(`UPDATE users SET role='HOD' WHERE id='${user}';`);
      assert.equal(
        call(
          edit(pending, {
            status: "confirmed",
            confirmed_by: user,
            confirmed_at: "1900-01-01",
            watch_versions: watches(),
          }),
        ).status,
        "forbidden",
      );
      sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);
      const confirm = edit(pending, {
        status: "confirmed",
        confirmed_by: user,
        confirmed_at: "1900-01-01",
        watch_versions: watches(),
      });
      confirmed = call(confirm);
      assert.equal(confirmed.status, "applied");
      assert.notEqual(confirmed.value.confirmed_at, "1900-01-01");
      assert.deepEqual(call(confirm), confirmed);
      assert.equal(
        call({ ...confirm, id: crypto.randomUUID() }).status,
        "conflict",
      );
      sql(`UPDATE users SET role='CREW' WHERE id='${user}';`);
      assert.equal(
        call(
          edit(confirmed, {
            status: "draft",
            confirmed_by: null,
            confirmed_at: null,
          }),
        ).status,
        "forbidden",
      );
      sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);
    },
  );
  await t.test(
    "rest: stale displayed watch snapshot cannot silently confirm",
    () => {
      const change = edit(confirmed, {
        status: "confirmed",
        watch_versions: watches(),
      });
      sql(
        "UPDATE watch_keeping_timetables SET notes='Changed online after review' WHERE id=(SELECT id FROM watch_keeping_timetables LIMIT 1);",
      );
      assert.equal(call(change).status, "conflict");
      assert.equal(
        sql(`SELECT comment FROM rest_entries WHERE id='${value.id}';`),
        "Honest short rest",
      );
    },
  );
  await t.test(
    "rest: foreign-owner spoofing, moved dates, invalid intervals and missing signature cannot write",
    () => {
      assert.equal(
        call(edit(confirmed, { user_id: crypto.randomUUID() })).status,
        "forbidden",
      );
      assert.throws(
        () =>
          call(
            edit(confirmed, {
              date: "2026-11-02",
              status: "draft",
              confirmed_by: null,
              confirmed_at: null,
            }),
          ),
        /Immutable rest identity/,
      );
      for (const bad of [
        { work_start: "29:00" },
        { rest_periods: [{ start: "00:00", end: "09:00", extra: true }] },
        { secret: true },
        { date: "2026-02-31" },
      ])
        assert.throws(() => call(edit(confirmed, bad)));
      sql(`DELETE FROM user_signatures WHERE user_id='${user}';`);
      assert.equal(
        call(
          edit(confirmed, {
            status: "draft",
            confirmed_by: null,
            confirmed_at: null,
          }),
        ).status,
        "forbidden",
      );
      sql(
        `INSERT INTO user_signatures(user_id,signature_type,typed_name) VALUES('${user}','typed','Synthetic Captain');`,
      );
    },
  );
  await t.test(
    "rest: existing long comments survive unchanged; new oversized comments fail",
    () => {
      sql(
        `UPDATE rest_entries SET comment='Historical comment longer than twenty characters' WHERE id='${value.id}';`,
      );
      const row = JSON.parse(
        run(
          `SELECT jsonb_build_object('value',to_jsonb(r)||jsonb_build_object('watch_versions','{}'::jsonb),'revision',md5(to_jsonb(r)::text)) FROM rest_entries r WHERE id='${value.id}';`,
        ),
      );
      const update = edit(row, {
        status: "draft",
        confirmed_by: null,
        confirmed_at: null,
      });
      const result = call(update);
      assert.equal(result.status, "applied");
      assert.throws(
        () =>
          call(
            edit(result, {
              comment: "Changed comment longer than twenty characters",
            }),
          ),
        /Comment too long/,
      );
    },
  );
  await t.test(
    "rest: captain may review another current crew member; HOD cannot",
    () => {
      const other = "00000000-0000-0000-0000-000000000009";
      sql(
        `INSERT INTO users(id,vessel_id,role,name,department,position) VALUES('${other}','${vessel}','CREW','Synthetic crew','BRIDGE','Deckhand') ON CONFLICT(id) DO UPDATE SET vessel_id='${vessel}';`,
      );
      const id = crypto.randomUUID();
      const review = {
        ...op,
        id: crypto.randomUUID(),
        recordId: id,
        feature: "restReview",
        value: {
          ...value,
          id,
          user_id: other,
          status: "confirmed",
          confirmed_by: user,
          confirmed_at: "local",
          watch_versions: watches(),
        },
      };
      const result = call(review);
      assert.equal(result.status, "applied");
      sql(`UPDATE users SET role='HOD' WHERE id='${user}';`);
      assert.equal(call(review).status, "forbidden");
      sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);
      assert.deepEqual(call(review), result);
    },
  );
}
