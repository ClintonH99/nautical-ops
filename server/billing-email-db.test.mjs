import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

test(
  "exact migration: server-only access, disabled startup, live-only trigger and exclusive leases",
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
      CREATE TABLE public.test_calls(id int);
      CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int)
        RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.test_calls VALUES(1); RETURN 1; END $$;
      CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
      CREATE TABLE public.users(id uuid PRIMARY KEY);
      CREATE TABLE public.paddle_subscription_links(subscription_id text PRIMARY KEY,vessel_id uuid,environment text);
      CREATE TABLE public.vessel_subscriptions(vessel_id uuid,payment_provider text,paddle_subscription_id text);
    `);
      await db.exec(
        readFileSync(
          new URL(
            "../yachy-app/supabase/migrations/20261103122752_billing_confirmation_emails.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      assert.equal(
        (await db.query("select enabled from billing_email_runtime")).rows[0]
          .enabled,
        false,
      );
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`SET ROLE ${role}`);
        await assert.rejects(
          db.query("select * from billing_email_jobs"),
          /permission denied/,
        );
        await assert.rejects(
          db.query("select * from claim_billing_email_jobs()"),
          /permission denied/,
        );
        await assert.rejects(
          db.query("select wake_billing_email_worker()"),
          /permission denied/,
        );
        await db.exec("RESET ROLE");
      }
      const vessel = "11111111-1111-4111-8111-111111111111";
      const subs = ["a", "b", "c", "d"].map((c) => "sub_" + c.repeat(26));
      for (let i = 0; i < subs.length; i++) {
        await db.query(
          "insert into paddle_subscription_links values($1,$2,$3)",
          [subs[i], vessel, i === 3 ? "sandbox" : "live"],
        );
        await db.query("insert into vessel_subscriptions values($1,$2,$3)", [
          vessel,
          "paddle",
          subs[i],
        ]);
      }
      assert.equal(
        (await db.query("select * from billing_email_jobs")).rows.length,
        0,
      );
      await db.exec(
        "update billing_email_runtime set enabled=true; update vessel_subscriptions set payment_provider=payment_provider",
      );
      assert.equal(
        (await db.query("select * from billing_email_jobs")).rows.length,
        3,
      );
      await db.exec(
        "update vessel_subscriptions set payment_provider=payment_provider",
      );
      assert.equal(
        (await db.query("select * from billing_email_jobs")).rows.length,
        3,
      );
      await db.exec("SET ROLE service_role");
      const first = (await db.query("select * from claim_billing_email_jobs()"))
        .rows;
      const second = (
        await db.query("select * from claim_billing_email_jobs()")
      ).rows;
      assert.equal(first.length, 2);
      assert.equal(second.length, 1);
      assert.equal(
        new Set([...first, ...second].map((j) => j.subscription_id)).size,
        3,
      );
      assert.equal(
        (await db.query("select * from claim_billing_email_jobs()")).rows
          .length,
        0,
      );
      await db.exec(
        "update billing_email_jobs set lease_until=now()-interval '1 minute',attempts=12",
      );
      assert.equal(
        (await db.query("select * from claim_billing_email_jobs()")).rows
          .length,
        0,
      );
      await db.exec("RESET ROLE");
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from pg_class where relname like 'billing_email_%' and relkind='r' and relrowsecurity",
          )
        ).rows[0].n,
        3,
      );
    } finally {
      await db.close();
    }
  },
);
