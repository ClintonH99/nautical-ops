import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

test(
  "trial recovery SQL: scoped release, audit, safe retry and service-only access",
  { skip: !process.env.BILLING_TEST_PGLITE_MODULE },
  async () => {
    const { PGlite } = await import(
      pathToFileURL(process.env.BILLING_TEST_PGLITE_MODULE)
    );
    const db = new PGlite();
    const vessel = "11111111-1111-4111-8111-111111111111";
    const user = "22222222-2222-4222-8222-222222222222";
    const intent = "33333333-3333-4333-8333-333333333333";
    const other = "44444444-4444-4444-8444-444444444444";
    const release = (patch = {}) =>
      db.query(
        "select public.release_failed_paddle_trial($1,$2,$3,$4,$5,$6) as released",
        [
          patch.id || intent,
          patch.vessel || vessel,
          patch.user || user,
          patch.environment || "live",
          patch.reason || "transaction_checkout_not_enabled",
          "test-request",
        ],
      );
    try {
      await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
   GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
   CREATE SCHEMA auth;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${user}'::uuid $$;
   CREATE FUNCTION public.current_session_has_device_access() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
   CREATE TABLE vessels(id uuid PRIMARY KEY,is_solo boolean DEFAULT false);
   CREATE TABLE users(id uuid PRIMARY KEY,vessel_id uuid,role text);
   CREATE TABLE vessel_subscriptions(vessel_id uuid);
   CREATE TABLE paddle_subscription_links(vessel_id uuid);
   CREATE TABLE paddle_checkout_intents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vessel_id uuid,user_id uuid,
     environment text,flow text,plan_tier text,billing_period text,price_id text,transaction_id text,
     state text DEFAULT 'creating',previous_subscription_id text,created_at timestamptz DEFAULT now());
   CREATE UNIQUE INDEX one_open ON paddle_checkout_intents(vessel_id) WHERE state IN ('creating','ready');
   GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
  `);
      await db.exec(
        readFileSync(
          new URL(
        "../yachy-app/supabase/migrations/20261105142307_rejected_trial_recovery.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const reserve = readFileSync(
        new URL(
          "../yachy-app/supabase/migrations/20261020120000_PADDLE_ENVIRONMENT_BILLING.sql",
          import.meta.url,
        ),
        "utf8",
      ).split("-- This lookup")[0];
      await db.exec(reserve);
      await db.query("insert into vessels(id) values($1)", [vessel]);
      await db.query("insert into users values($1,$2,'CAPTAIN_MOV')", [
        user,
        vessel,
      ]);
      const seed = () =>
        db.query(
          "insert into paddle_checkout_intents(id,vessel_id,user_id,environment,flow,plan_tier,billing_period,price_id) values($1,$2,$3,'live','cardless_trial','1_5','monthly','price')",
          [intent, vessel, user],
        );
      await seed();
      for (const role of ["anon", "authenticated"]) {
        await db.exec("SET ROLE " + role);
        await assert.rejects(release(), /permission denied/);
        await db.exec("RESET ROLE");
      }
      for (const patch of [
        { id: other },
        { vessel: other },
        { user: other },
        { environment: "sandbox" },
        { reason: "timeout" },
      ]) {
        assert.equal((await release(patch)).rows[0].released, false);
      }
      for (const update of [
        "state='ready'",
        "state='completed'",
        "transaction_id='txn_existing'",
        "flow='paid_reactivation'",
        "previous_subscription_id='sub_old'",
      ]) {
        await db.exec("BEGIN");
        await db.exec("update paddle_checkout_intents set " + update);
        assert.equal((await release()).rows[0].released, false);
        await db.exec("ROLLBACK");
      }
      for (const table of [
        "vessel_subscriptions",
        "paddle_subscription_links",
      ]) {
        await db.exec("BEGIN");
        await db.query("insert into " + table + " values($1)", [vessel]);
        assert.equal((await release()).rows[0].released, false);
        await db.exec("ROLLBACK");
      }
      const reserveArgs = [vessel, "1_5", "monthly", "price", "live"];
      const again = await db.query(
        "select reserve_paddle_trial($1,$2,$3,$4,$5) as intent",
        reserveArgs,
      );
      assert.equal(again.rows[0].intent.created, false); // double click cannot create another
      await db.exec("SET ROLE service_role");
      assert.equal((await release()).rows[0].released, true);
      assert.equal((await release()).rows[0].released, false); // no second mutation
      await db.exec("RESET ROLE");
      const audit = (
        await db.query("select * from paddle_checkout_intents where id=$1", [
          intent,
        ])
      ).rows[0];
      assert.equal(audit.state, "canceled");
      assert.equal(audit.failure_reason, "transaction_checkout_not_enabled");
      assert.equal(audit.failure_request_id, "test-request");
      assert.ok(audit.failed_at);
      assert.equal(audit.transaction_id, null);
      const retry = (
        await db.query(
          "select reserve_paddle_trial($1,$2,$3,$4,$5) as intent",
          reserveArgs,
        )
      ).rows[0].intent;
      assert.equal(retry.created, true);
      assert.notEqual(retry.id, intent);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from paddle_checkout_intents",
          )
        ).rows[0].n,
        2,
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from paddle_checkout_intents where state='creating'",
          )
        ).rows[0].n,
        1,
      );
    } finally {
      await db.close();
    }
  },
);
