import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const bin =
  process.env.OFFLINE_TEST_PG_BIN || "/opt/homebrew/opt/postgresql@17/bin";
test("real isolated PostgreSQL offline note protocol", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nautical-offline-db-"));
  execFileSync(
    join(bin, "initdb"),
    ["-D", join(dir, "data"), "-A", "trust", "--no-locale"],
    { stdio: "pipe" },
  );
  execFileSync(
    join(bin, "pg_ctl"),
    [
      "-D",
      join(dir, "data"),
      "-l",
      join(dir, "server.log"),
      "-o",
      `-k ${dir} -c listen_addresses=''`,
      "-w",
      "start",
    ],
    { stdio: "pipe" },
  );
  const sql = (source) =>
    execFileSync(
      join(bin, "psql"),
      ["-h", dir, "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
      { input: source, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
  const user = "00000000-0000-0000-0000-000000000001",
    vessel = "00000000-0000-0000-0000-000000000002",
    session = "00000000-0000-0000-0000-000000000003",
    note = "00000000-0000-0000-0000-000000000004";
  const device = "a".repeat(64);
  const auth = `SET ROLE authenticated; SET request.jwt.claim.sub='${user}'; SET request.jwt.claim.session_id='${session}';`;
  const run = (source) =>
    sql(auth + source)
      .split("\n")
      .at(-1);
  const value = {
    id: note,
    vessel_id: vessel,
    user_id: user,
    title: "At sea",
    content: "Saved offline",
    created_by_name: "Synthetic captain",
    created_at: "2026-11-09T00:00:00Z",
    updated_at: "2026-11-09T00:00:00Z",
  };
  const op = {
    id: "00000000-0000-0000-0000-000000000005",
    recordId: note,
    kind: "create",
    feature: "notes",
    value,
    baseRevision: null,
  };
  const apply = (x) =>
    `SELECT public.sync_web_offline_note('${vessel}','${device}','${JSON.stringify(x).replaceAll("'", "''")}'::jsonb);`;
  try {
    sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE postgres; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true))$$;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
      CREATE TABLE users(id uuid PRIMARY KEY,vessel_id uuid);
      CREATE TABLE user_devices(user_id uuid,session_id uuid,device_fingerprint text,revoked_at timestamptz,platform text);
      CREATE TABLE vessel_subscriptions(vessel_id uuid,status text,current_period_end timestamptz,grace_period_end timestamptz);
      CREATE TABLE notes(id uuid PRIMARY KEY,vessel_id uuid,user_id uuid,title text,content text,created_by_name text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION public.current_user_can_access_vessel(v uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.users u JOIN public.user_devices d ON d.user_id=u.id WHERE u.id=auth.uid() AND u.vessel_id=v AND d.session_id::text=auth.jwt()->>'session_id' AND d.revoked_at IS NULL)$$;
      CREATE POLICY own_notes ON notes TO authenticated USING(user_id=auth.uid() AND public.current_user_can_access_vessel(vessel_id)) WITH CHECK(user_id=auth.uid() AND public.current_user_can_access_vessel(vessel_id));
      GRANT USAGE ON SCHEMA auth TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON notes TO authenticated;
      INSERT INTO auth.users VALUES('${user}'); INSERT INTO auth.sessions(id,user_id) VALUES('${session}','${user}'); INSERT INTO users VALUES('${user}','${vessel}');
      INSERT INTO user_devices VALUES('${user}','${session}','${device}',null,'web');
      INSERT INTO vessel_subscriptions VALUES('${vessel}','trialing',now()+interval '30 days',null);`);
    sql(
      readFileSync(
        new URL(
          "../yachy-app/supabase/migrations/20261110003026_web_offline_notes.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const baseline = readFileSync(
      new URL(
        "../yachy-app/supabase/migrations/20260213000000_PRODUCTION_SCHEMA_BASELINE.sql",
        import.meta.url,
      ),
      "utf8",
    );
    sql(
      baseline.match(
        /CREATE TABLE IF NOT EXISTS "public"\."shopping_lists" \([\s\S]*?\n\);/,
      )[0],
    );
    sql(`ALTER TABLE shopping_lists ADD PRIMARY KEY(id); ALTER TABLE shopping_lists ENABLE ROW LEVEL SECURITY;
      CREATE POLICY active_shopping ON shopping_lists TO authenticated USING(public.current_user_can_access_vessel(vessel_id)) WITH CHECK(public.current_user_can_access_vessel(vessel_id));
      GRANT SELECT,INSERT,UPDATE,DELETE ON shopping_lists TO authenticated;`);
    sql(
      readFileSync(
        new URL(
          "../yachy-app/supabase/migrations/20261110020000_web_offline_shopping.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    let first;
    await t.test("grant binds session and caps access at seven days", () => {
      const c = JSON.parse(
        run(`SELECT get_web_offline_context('${vessel}','${device}');`),
      );
      assert.equal(c.exp - c.iat, 604800);
      assert.equal(c.sessionId, session);
    });
    await t.test(
      "create and identical retry commit one record and one receipt",
      () => {
        first = JSON.parse(run(apply(op)));
        assert.equal(first.status, "applied");
        assert.deepEqual(JSON.parse(run(apply(op))), first);
        assert.equal(sql("SELECT count(*) FROM notes;"), "1");
        assert.equal(
          sql("SELECT count(*) FROM offline_private.note_receipts;"),
          "1",
        );
      },
    );
    await t.test("changed payload under same ID rejected", () =>
      assert.throws(() =>
        run(apply({ ...op, value: { ...value, title: "Changed" } })),
      ),
    );
    await t.test("private receipt table cannot be read by the app role", () =>
      assert.throws(() => run("SELECT * FROM offline_private.note_receipts;")),
    );
    await t.test("wrong owner and wrong device rejected", () => {
      assert.throws(() =>
        run(
          apply({
            ...op,
            id: "00000000-0000-0000-0000-000000000006",
            value: { ...value, user_id: vessel },
          }),
        ),
      );
      assert.throws(() =>
        run(`SELECT get_web_offline_context('${vessel}','wrong-device');`),
      );
    });
    await t.test(
      "update compares real row revision and preserves concurrent online edit",
      () => {
        sql(`UPDATE notes SET content='Online change' WHERE id='${note}';`);
        const update = {
          ...op,
          id: "00000000-0000-0000-0000-000000000007",
          kind: "update",
          baseRevision: first.revision,
        };
        assert.equal(JSON.parse(run(apply(update))).status, "conflict");
        assert.equal(
          sql(`SELECT content FROM notes WHERE id='${note}';`),
          "Online change",
        );
        const fresh = JSON.parse(
          run(`SELECT read_web_offline_notes('${vessel}','${device}');`),
        )[0];
        update.baseRevision = fresh.revision;
        assert.equal(JSON.parse(run(apply(update))).status, "applied");
      },
    );
    await t.test(
      "revocation blocks replay of previously successful operation",
      () => {
        sql("UPDATE user_devices SET revoked_at=now();");
        assert.throws(() => run(apply(op)));
        sql("UPDATE user_devices SET revoked_at=null;");
      },
    );
    await t.test(
      "the same user and browser can reconcile a lost reply after signing in again",
      () => {
        const renewed = "00000000-0000-0000-0000-000000000008";
        sql(
          `INSERT INTO auth.sessions(id,user_id) VALUES('${renewed}','${user}'); UPDATE user_devices SET session_id='${renewed}';`,
        );
        const response = JSON.parse(
          sql(auth.replace(session, renewed) + apply(op))
            .split("\n")
            .at(-1),
        );
        assert.equal(response.status, "applied");
        assert.equal(response.operationId, op.id);
        assert.equal(sql("SELECT count(*) FROM notes;"), "1");
        sql(`UPDATE user_devices SET session_id='${session}';`);
      },
    );
    await t.test(
      "time-limited auth session expiry blocks access before subscription expiry",
      () => {
        sql(
          `UPDATE auth.sessions SET not_after=now()-interval '1 minute' WHERE id='${session}';`,
        );
        assert.throws(() => run(apply(op)));
        sql(`UPDATE auth.sessions SET not_after=null WHERE id='${session}';`);
      },
    );
    await t.test(
      "shopping writes use actual table policies and atomic receipts",
      () => {
        const id = "00000000-0000-0000-0000-000000000020";
        const record = {
          id,
          vessel_id: vessel,
          created_by: user,
          created_at: new Date().toISOString(),
          department: "BRIDGE",
          title: "Supplies",
          list_type: "general",
          is_master: false,
          items: [{ text: "Water", amount: "4", checked: false }],
        };
        const change = {
          id: "00000000-0000-0000-0000-000000000021",
          recordId: id,
          feature: "shoppingLists",
          kind: "create",
          baseRevision: null,
          value: record,
        };
        const shopping = (x) =>
          `SELECT sync_web_offline_shopping('${vessel}','${device}','${JSON.stringify(x).replaceAll("'", "''")}'::jsonb);`;
        const created = JSON.parse(run(shopping(change)));
        assert.equal(created.status, "applied");
        assert.deepEqual(JSON.parse(run(shopping(change))), created);
        assert.equal(sql("SELECT count(*) FROM shopping_lists;"), "1");
        assert.equal(
          sql("SELECT count(*) FROM offline_private.record_receipts;"),
          "1",
        );
        assert.throws(() =>
          run("SELECT * FROM offline_private.record_receipts;"),
        );
        assert.throws(() =>
          sql(
            "SET SESSION AUTHORIZATION authenticated; SET ROLE nautical_offline_writer;",
          ),
        );
        assert.throws(() =>
          run(
            shopping({
              ...change,
              value: { ...record, title: "Tampered retry" },
            }),
          ),
        );
        const update = {
          ...change,
          id: "00000000-0000-0000-0000-000000000022",
          kind: "update",
          baseRevision: created.revision,
          value: { ...created.value, title: "Edited supplies" },
        };
        assert.equal(JSON.parse(run(shopping(update))).status, "applied");
        const stale = {
          ...update,
          id: "00000000-0000-0000-0000-000000000023",
          value: { ...record, title: "Stale edit" },
        };
        assert.equal(JSON.parse(run(shopping(stale))).status, "conflict");
        // A later restrictive policy must also apply to the offline function.
        sql(
          `CREATE POLICY no_shopping_edits ON shopping_lists AS RESTRICTIVE FOR UPDATE TO authenticated USING(false);`,
        );
        const current = JSON.parse(
          run(`SELECT read_web_offline_shopping('${vessel}','${device}');`),
        )[0];
        const denied = JSON.parse(
          run(shopping({ ...stale, baseRevision: current.revision })),
        );
        assert.equal(denied.status, "forbidden");
        assert.equal(
          sql(`SELECT title FROM shopping_lists WHERE id='${id}';`),
          "Edited supplies",
        );
        assert.equal(
          sql("SELECT count(*) FROM offline_private.record_receipts;"),
          "2",
        );
        sql("DROP POLICY no_shopping_edits ON shopping_lists;");
        sql(
          `CREATE POLICY no_shopping_reads ON shopping_lists AS RESTRICTIVE FOR SELECT TO authenticated USING(false);`,
        );
        assert.deepEqual(
          JSON.parse(
            run(`SELECT read_web_offline_shopping('${vessel}','${device}');`),
          ),
          [],
        );
        assert.equal(JSON.parse(run(shopping(change))).status, "forbidden");
        sql("DROP POLICY no_shopping_reads ON shopping_lists;");
      },
    );
    await t.test(
      "expired trial and deleted auth session prevent grants and writes",
      () => {
        sql(
          "UPDATE vessel_subscriptions SET current_period_end=now()-interval '1 day';",
        );
        assert.throws(() => run(apply(op)));
        sql(
          "UPDATE vessel_subscriptions SET current_period_end=now()+interval '1 day'; DELETE FROM auth.sessions;",
        );
        assert.throws(() => run(apply(op)));
      },
    );
  } finally {
    execFileSync(
      join(bin, "pg_ctl"),
      ["-D", join(dir, "data"), "-m", "fast", "-w", "stop"],
      { stdio: "pipe" },
    );
  }
});
