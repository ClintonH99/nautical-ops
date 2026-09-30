// Disposable PostgreSQL only. No connection to the linked/live database.
// PGLITE_MODULE_PATH points to a separately installed @electric-sql/pglite.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const read = (file) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

(async () => {
  const db = new PGlite();
  let checks = 0;
  const check = (actual, expected) => {
    assert.deepEqual(actual, expected);
    checks++;
  };
  const asUser = async (user, fn) => {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id(user)]);
    await db.exec('SET ROLE authenticated');
    try {
      return await fn();
    } finally {
      await db.exec('RESET ROLE');
    }
  };
  try {
    await db.exec(
      read('supabase/tests/minimal_foundation_schema.sql').replace(
        'CREATE EXTENSION IF NOT EXISTS pgcrypto;',
        ''
      )
    );
    await db.exec(read('supabase/tests/local_auth_bootstrap.sql').replace(/^\\.*$/gm, ''));
    const baseline = read('supabase/migrations/20260213000000_PRODUCTION_SCHEMA_BASELINE.sql');
    for (const table of ['watch_keeping_timetables', 'rest_entries']) {
      const definition = baseline.match(
        new RegExp('CREATE TABLE IF NOT EXISTS "public"\\."' + table + '" \\([\\s\\S]*?\\n\\);')
      );
      assert.ok(definition, `Missing production schema for ${table}`);
      await db.exec(definition[0]);
      await db.exec(
        `ALTER TABLE public.${table} ADD PRIMARY KEY (id); ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`
      );
    }
    await db.exec(`
      CREATE FUNCTION public.current_session_has_device_access() RETURNS BOOLEAN LANGUAGE SQL STABLE
        AS $$ SELECT COALESCE(current_setting('test.device_allowed', true), 'yes') <> 'no' $$;
      GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
      GRANT SELECT ON public.users, public.vessels TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.watch_keeping_timetables TO authenticated;
    `);
    const security = read('supabase/migrations/20260903152000_SERVER_SIDE_ACCESS_ENFORCEMENT.sql');
    for (const name of [
      'vessel_subscription_allows_access',
      'current_user_can_access_vessel',
      'current_user_can_manage_vessel',
    ]) {
      const definition = security.match(
        new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '\\([\\s\\S]*?\\$\\$;')
      );
      assert.ok(definition, `Missing production function ${name}`);
      await db.exec(definition[0]);
    }
    // Replay the actual HOD/Captain table policies, not simplified test guards.
    const policies = security.match(
      /-- HOD\/Captain-managed tables[\s\S]*?DO \$\$[\s\S]*?END\n\$\$;/
    );
    assert.ok(policies);
    await db.exec(policies[0]);
    await db.exec(read('supabase/migrations/20260927130000_PERSONAL_WATCH_SCHEDULE_CREATE.sql'));
    await db.exec(read('supabase/migrations/20260930100000_ATOMIC_WATCH_PUBLICATION.sql'));
    await db.exec(`
      INSERT INTO vessels(id,name,invite_code,is_solo) VALUES
        ('${id(1)}','Shared A','A',false), ('${id(2)}','Other vessel','B',false), ('${id(3)}','Personal','C',true);
      INSERT INTO users(id,vessel_id,role) VALUES
        ('${id(10)}','${id(1)}','CAPTAIN_MOV'), ('${id(11)}','${id(1)}','HOD'),
        ('${id(12)}','${id(1)}','CREW'), ('${id(13)}','${id(2)}','CAPTAIN_MOV'), ('${id(14)}','${id(3)}','CREW');
      INSERT INTO rest_entries(user_id,vessel_id,date,status,confirmed_by,confirmed_at)
        SELECT '${id(12)}','${id(1)}',day,'confirmed','${id(10)}',now()
        FROM generate_series('2026-09-30'::date,'2026-10-04'::date,'1 day') day;
      INSERT INTO rest_entries(user_id,vessel_id,date,status) VALUES ('${id(12)}','${id(2)}','2026-09-30','confirmed');
    `);
    const slot = {
      crewId: id(12),
      crewName: 'Crew',
      startTimeStr: '22:00',
      endTimeStr: '02:00',
      durationHours: 4,
      startDate: '2026-09-30',
      endDate: '2026-10-01',
    };
    const payload = {
      vessel_id: id(1),
      watch_title: 'Delivery',
      start_time: '22:00',
      for_date: '2026-09-30',
      slots: [slot],
    };
    const publish = (request, data = payload) =>
      db.query('SELECT public.publish_watch_schedule($1,$2) AS saved', [
        id(request),
        JSON.stringify(data),
      ]);
    const states = async () =>
      (
        await db.query(
          'SELECT date::text,status FROM rest_entries WHERE vessel_id=$1 ORDER BY date',
          [id(1)]
        )
      ).rows;
    const count = async (request) =>
      (
        await db.query('SELECT count(*)::int AS count FROM watch_keeping_timetables WHERE id=$1', [
          id(request),
        ])
      ).rows[0].count;
    // A rest-update failure must roll back the timetable INSERT as well.
    await db.exec(`CREATE FUNCTION test_fail_rest() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated rest failure'; END $$;
      CREATE TRIGGER test_fail_rest BEFORE UPDATE ON rest_entries FOR EACH ROW EXECUTE FUNCTION test_fail_rest();`);
    await assert.rejects(
      asUser(10, () => publish(100)),
      /simulated rest failure/
    );
    checks++;
    check(await count(100), 0);
    check(
      (await states()).every((row) => row.status === 'confirmed'),
      true
    );
    await db.exec('DROP TRIGGER test_fail_rest ON rest_entries');
    const saved = await asUser(10, () => publish(100));
    check(saved.rows[0].saved.created_by, id(10));
    check(
      (await states())
        .filter((row) => row.status === 'needs_reconfirmation')
        .map((row) => row.date),
      ['2026-09-30', '2026-10-01']
    );
    check(
      (await db.query('SELECT status FROM rest_entries WHERE vessel_id=$1', [id(2)])).rows[0]
        .status,
      'confirmed'
    );
    // Simulate a lost response, reconfirm, then retry the same request.
    await db.exec("UPDATE rest_entries SET status='confirmed'");
    await asUser(10, () => publish(100));
    check(await count(100), 1);
    check(
      (await states()).every((row) => row.status === 'confirmed'),
      true
    );
    await assert.rejects(
      asUser(10, () => publish(100, { ...payload, watch_title: 'Changed' })),
      /earlier publish was saved/
    );
    checks++;
    await assert.rejects(
      asUser(11, () => publish(100)),
      /not available/
    );
    checks++;
    // Role, vessel, device and subscription permissions remain in force.
    await asUser(11, () => publish(101));
    check(await count(101), 1);
    await assert.rejects(
      asUser(12, () => publish(102)),
      /row-level security/
    );
    checks++;
    await assert.rejects(
      asUser(13, () => publish(103)),
      /row-level security/
    );
    checks++;
    await asUser(14, () =>
      publish(104, { ...payload, vessel_id: id(3), slots: [{ ...slot, crewId: id(14) }] })
    );
    check(await count(104), 1);
    await db.exec("SELECT set_config('test.device_allowed','no',false)");
    await assert.rejects(
      asUser(10, () => publish(105)),
      /row-level security/
    );
    checks++;
    await db.exec("SELECT set_config('test.device_allowed','yes',false)");
    await db.exec(
      `INSERT INTO vessel_subscriptions(vessel_id,status) VALUES ('${id(1)}','revoked')`
    );
    await assert.rejects(
      asUser(10, () => publish(105)),
      /row-level security/
    );
    checks++;
    await db.exec('DELETE FROM vessel_subscriptions');
    await db.exec('SET ROLE anon');
    try {
      await assert.rejects(publish(105), /permission denied/);
      checks++;
    } finally {
      await db.exec('RESET ROLE');
    }
    // Edits invalidate both old and new affected days. Deletion is atomic too.
    await db.exec("UPDATE rest_entries SET status='confirmed'");
    const moved = [{ ...slot, startDate: '2026-10-02', endDate: '2026-10-03' }];
    await asUser(11, () =>
      db.query('UPDATE watch_keeping_timetables SET slots=$1 WHERE id=$2', [
        JSON.stringify(moved),
        id(100),
      ])
    );
    check(
      (await states())
        .filter((row) => row.status === 'needs_reconfirmation')
        .map((row) => row.date),
      ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']
    );
    await db.exec("UPDATE rest_entries SET status='confirmed'");
    await asUser(11, () =>
      db.query('UPDATE watch_keeping_timetables SET slots=$1 WHERE id=$2', [
        JSON.stringify(moved),
        id(100),
      ])
    );
    check(
      (await states()).every((row) => row.status === 'confirmed'),
      true
    );
    await db.exec(
      'CREATE TRIGGER test_fail_rest BEFORE UPDATE ON rest_entries FOR EACH ROW EXECUTE FUNCTION test_fail_rest()'
    );
    await assert.rejects(
      asUser(10, () => db.query('DELETE FROM watch_keeping_timetables WHERE id=$1', [id(100)])),
      /simulated rest failure/
    );
    checks++;
    check(await count(100), 1);
    await db.exec('DROP TRIGGER test_fail_rest ON rest_entries');
    await asUser(10, () => db.query('DELETE FROM watch_keeping_timetables WHERE id=$1', [id(100)]));
    check(await count(100), 0);
    check(
      (await states())
        .filter((row) => row.status === 'needs_reconfirmation')
        .map((row) => row.date),
      ['2026-10-02', '2026-10-03']
    );
    // Exact midnight must not invalidate the following day; legacy and multi-day slots still work.
    const days = async (slots) =>
      (
        await db.query(
          'SELECT rest_date::text FROM watch_affected_rest_days($1,$2) ORDER BY rest_date',
          ['2026-09-30', JSON.stringify(slots)]
        )
      ).rows.map((row) => row.rest_date);
    check(await days([{ ...slot, endTimeStr: '00:00' }]), ['2026-09-30']);
    check(
      await days([
        { crewId: id(12), startTimeStr: '22:00', endTimeStr: '02:00' },
        { crewId: id(12), startTimeStr: '02:00', endTimeStr: '06:00' },
      ]),
      ['2026-09-30', '2026-10-01', '2026-10-01']
    );
    check(await days([{ ...slot, endDate: '2026-10-02' }]), [
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
    console.log(`${checks} watch publication database checks passed (disposable PostgreSQL).`);
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
