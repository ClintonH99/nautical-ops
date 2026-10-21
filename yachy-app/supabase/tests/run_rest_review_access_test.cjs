// Disposable PostgreSQL only. Never connects to Supabase or changes live records.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const read = (file) => fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8');
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
(async () => {
  const db = new PGlite();
  let checks = 0;
  const equal = (actual, expected) => {
    assert.deepEqual(actual, expected);
    checks++;
  };
  const asUser = async (id, action) => {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uuid(id)]);
    await db.exec('SET ROLE authenticated');
    try {
      return await action();
    } finally {
      await db.exec('RESET ROLE');
    }
  };
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS
        $$ SELECT current_setting('request.jwt.claim.sub',true)::UUID $$;
      CREATE TABLE users(id UUID PRIMARY KEY,vessel_id UUID,role TEXT,department TEXT);
      CREATE TABLE department_signers(vessel_id UUID,department TEXT,signer_user_id UUID);
      CREATE TABLE rest_entries(id INT PRIMARY KEY,user_id UUID,vessel_id UUID,status TEXT,comment TEXT);
      ALTER TABLE rest_entries ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA public,auth TO authenticated;
      GRANT SELECT,INSERT,UPDATE,DELETE ON rest_entries,department_signers TO authenticated;
      CREATE FUNCTION public.current_user_can_access_vessel(target_vessel_id UUID)
      RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
        SELECT current_setting('test.access',true) IS DISTINCT FROM 'denied'
          AND EXISTS (SELECT 1 FROM public.users WHERE id=auth.uid() AND vessel_id=target_vessel_id)
      $$;
      INSERT INTO users VALUES
        ('${uuid(10)}','${uuid(1)}','CAPTAIN_MOV','BRIDGE'),
        ('${uuid(11)}','${uuid(1)}','HOD','EXTERIOR'),
        ('${uuid(12)}','${uuid(1)}','CREW','EXTERIOR'),
        ('${uuid(13)}','${uuid(1)}','CREW','EXTERIOR'),
        ('${uuid(14)}','${uuid(2)}','CAPTAIN_MOV','BRIDGE');
      INSERT INTO department_signers VALUES
        ('${uuid(1)}','EXTERIOR','${uuid(11)}'),
        ('${uuid(1)}','EXTERIOR','${uuid(12)}');
      INSERT INTO rest_entries VALUES
        (1,'${uuid(13)}','${uuid(1)}','draft','original'),
        (2,'${uuid(13)}','${uuid(1)}','confirmed','signed'),
        (3,'${uuid(10)}','${uuid(1)}','draft','captain own');
    `);
    const foundation = read('20260903152000_SERVER_SIDE_ACCESS_ENFORCEMENT.sql');
    // Use the actual Captain helper and existing RLS, not reimplemented policies.
    await db.exec(
      foundation.slice(
        foundation.indexOf('CREATE OR REPLACE FUNCTION public.current_user_is_captain_of('),
        foundation.indexOf('CREATE OR REPLACE FUNCTION public.current_captain_can_assign_profile(')
      )
    );
    await db.exec(
      foundation.slice(
        foundation.indexOf('CREATE OR REPLACE FUNCTION public.current_user_can_manage_rest_entry('),
        foundation.indexOf('-- Remove every pre-existing policy')
      )
    );
    await db.exec(
      foundation.slice(
        foundation.indexOf('CREATE POLICY "Members and assigned reviewers read rest entries"'),
        foundation.indexOf('-- Crew-management records')
      )
    );
    const canReview = (id) =>
      asUser(
        id,
        async () =>
          (
            await db.query('SELECT current_user_can_manage_rest_entry($1,$2) AS allowed', [
              uuid(13),
              uuid(1),
            ])
          ).rows[0].allowed
      );
    equal(await canReview(11), true);
    equal(await canReview(12), true);
    await db.exec(read('20261021120000_CAPTAIN_ONLY_REST_REVIEW.sql'));
    for (const id of [11, 12, 14]) {
      equal(await canReview(id), false);
      equal((await asUser(id, () => db.query('SELECT * FROM rest_entries'))).rows, []);
      for (const change of ["comment='forged'", "status='confirmed'"]) {
        equal(
          (
            await asUser(id, () =>
              db.query(`UPDATE rest_entries SET ${change} WHERE id=1 RETURNING id`)
            )
          ).rows,
          []
        );
      }
      equal(
        (await asUser(id, () => db.query('DELETE FROM rest_entries WHERE id=2 RETURNING id'))).rows,
        []
      );
      await assert.rejects(
        () =>
          asUser(id, () =>
            db.query(
              `INSERT INTO rest_entries VALUES (9,'${uuid(13)}','${uuid(1)}','confirmed','forged')`
            )
          ),
        /row-level security/
      );
      checks++;
    }
    equal(await canReview(10), true);
    equal(
      (
        await asUser(10, () =>
          db.query("UPDATE rest_entries SET status='confirmed' WHERE id IN (1,3) RETURNING id")
        )
      ).rows.length,
      2
    );
    equal(
      (
        await asUser(10, () =>
          db.query("UPDATE rest_entries SET comment='corrected' WHERE id=2 RETURNING id")
        )
      ).rows.length,
      1
    );
    equal(
      (await asUser(10, () => db.query('DELETE FROM rest_entries WHERE id=2 RETURNING id'))).rows
        .length,
      1
    );
    await db.exec("UPDATE rest_entries SET status='draft' WHERE id=1");
    equal(
      (
        await asUser(13, () =>
          db.query("UPDATE rest_entries SET comment='own edit' WHERE id=1 RETURNING id")
        )
      ).rows.length,
      1
    );
    await assert.rejects(
      () => asUser(13, () => db.query("UPDATE rest_entries SET status='confirmed' WHERE id=1")),
      /row-level security/
    );
    checks++;
    await db.exec("SELECT set_config('test.access','denied',false)");
    equal(await canReview(10), false);
    await db.exec("SELECT set_config('test.access','allowed',false)");
    await assert.rejects(
      () => asUser(10, () => db.query('DELETE FROM department_signers')),
      /permission denied/
    );
    checks++;
    equal((await db.query('SELECT * FROM department_signers')).rows.length, 2);
    console.log(`Passed ${checks} Captain-only rest permission checks.`);
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
