import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

test(
  "welcome queue exact SQL: future events, one welcome, atomic trigger, leases and permissions",
  { skip: !process.env.BILLING_TEST_PGLITE_MODULE },
  async () => {
    const { PGlite } = await import(
      pathToFileURL(process.env.BILLING_TEST_PGLITE_MODULE)
    );
    const db = new PGlite();
    try {
      await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
      CREATE SCHEMA vault; CREATE SCHEMA net; CREATE SCHEMA cron;
      CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
      INSERT INTO vault.decrypted_secrets VALUES('notification_worker_secret',repeat('x',40));
      CREATE TABLE test_calls(id int);
      CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int)
        RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN INSERT INTO test_calls VALUES(1); RETURN 1; END $$;
      CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
      CREATE TABLE users(id uuid PRIMARY KEY,email text,name text,role text,vessel_id uuid);
      CREATE TABLE vessels(id uuid PRIMARY KEY,name text,is_solo boolean);
    `);
      const v = "11111111-1111-4111-8111-111111111111";
      const uid = (n) =>
        String(n).padStart(8, "0") + "-1111-4111-8111-111111111111";
      await db.query("insert into vessels values($1,$2,false)", [v, "Example"]);
      const signup = (n, role = "CAPTAIN_MOV", vessel = v) =>
        db.query("insert into users values($1,$2,$3,$4,$5)", [
          uid(n),
          "example@example.com",
          "Example",
          role,
          vessel,
        ]);
      await signup(1); // predates migration: never backfilled
      await db.exec(
        readFileSync(
          new URL(
            "../yachy-app/supabase/migrations/20261104151506_welcome_email_queue.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await signup(2); // disabled cutover: old handler still owns these events
      assert.equal(
        (await db.query("select * from welcome_email_jobs")).rows.length,
        0,
      );
      for (const role of ["anon", "authenticated"]) {
        await db.exec("SET ROLE " + role);
        for (const sql of [
          "select * from welcome_email_jobs",
          "select * from welcome_email_runtime",
          "select * from claim_welcome_email_jobs()",
          "select wake_welcome_email_worker()",
          "select enqueue_welcome_email()",
        ])
          await assert.rejects(db.query(sql), /permission denied/);
        await db.exec("RESET ROLE");
      }
      await db.exec("update welcome_email_runtime set enabled=true");
      await db.query("update users set name=$1", ["changed"]);
      assert.equal(
        (await db.query("select * from welcome_email_jobs")).rows.length,
        0,
      );
      await signup(3, "CAPTAIN_MOV", null);
      await db.query("update users set vessel_id=$1 where id=$2", [v, uid(3)]);
      await signup(4, "CREW");
      await db.query("update vessels set is_solo=true where id=$1", [v]);
      await signup(5, "CREW");
      assert.deepEqual(
        (
          await db.query("select kind from welcome_email_jobs order by user_id")
        ).rows.map((r) => r.kind),
        ["captain", "crew_joined", "crew_solo"],
      );
      await db.query("update users set vessel_id=null where id=$1", [uid(3)]);
      await db.query("update users set vessel_id=$1 where id=$2", [v, uid(3)]);
      assert.equal(
        (await db.query("select * from welcome_email_jobs")).rows.length,
        3,
      );
      await db.exec("BEGIN");
      await signup(6);
      await db.exec("ROLLBACK");
      assert.equal(
        (await db.query("select * from welcome_email_jobs")).rows.length,
        3,
      );
      await db.exec("SET ROLE service_role");
      const a = (await db.query("select * from claim_welcome_email_jobs()"))
        .rows;
      const b = (await db.query("select * from claim_welcome_email_jobs()"))
        .rows;
      assert.equal(a.length, 2);
      assert.equal(b.length, 1);
      assert.equal(new Set([...a, ...b].map((j) => j.user_id)).size, 3);
      assert.equal(
        (await db.query("select * from claim_welcome_email_jobs()")).rows
          .length,
        0,
      );
      await db.exec(
        "update welcome_email_jobs set lease_until=now()-interval '1 minute',status='accepted',delivery_checks=12",
      );
      assert.equal(
        (await db.query("select * from claim_welcome_email_jobs()")).rows
          .length,
        0,
      );
      await db.exec(
        "update welcome_email_jobs set status='pending',attempts=12",
      );
      const exhausted = (
        await db.query("select * from claim_welcome_email_jobs()")
      ).rows;
      assert.equal(exhausted[0].attempts, 13); // claimed once more to mark review, not silently orphaned
      await db.exec("RESET ROLE");
      await db.query("delete from users where id=$1", [uid(3)]);
      assert.equal(
        (await db.query("select * from welcome_email_jobs")).rows.length,
        2,
      );
    } finally {
      await db.close();
    }
  },
);
