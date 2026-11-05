// Isolated PostgreSQL regression checks against the credential-free production
// catalogue snapshot. No network, customer records, or production writes.
// Device registration is deliberately stubbed; its implementation is not tested.
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const modulePath = process.env.BILLING_TEST_PGLITE_MODULE;
describe(
  "subscription expiry PostgreSQL policies",
  { skip: !modulePath },
  async () => {
    const { PGlite } = await import(pathToFileURL(modulePath).href);
    const snapshot = JSON.parse(
      await readFile(
        new URL(
          "./fixtures/subscription-access-20261105.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const migration = await readFile(
      new URL(
        "../yachy-app/supabase/migrations/20261105150815_enforce_legacy_task_subscription_access.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const db = new PGlite();
    const vessel = "00000000-0000-0000-0000-000000000001";
    const otherVessel = "00000000-0000-0000-0000-000000000002";
    const captain = "00000000-0000-0000-0000-000000000011";
    const crew = "00000000-0000-0000-0000-000000000012";
    const hod = "00000000-0000-0000-0000-000000000013";
    const outsider = "00000000-0000-0000-0000-000000000014";
    const modern = [
      "inventory_items",
      "maintenance_logs",
      "trips",
      "vessel_tasks",
    ];
    const protectedTables = [...modern, "tasks"];
    const ident = (s) => '"' + s.replaceAll('"', '""') + '"';

    before(async () => {
      await db.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT current_setting('request.jwt.claim.sub', true)::uuid $$;
    CREATE FUNCTION public.current_session_has_device_access() RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT coalesce(nullif(current_setting('test.device_access', true), ''), 'true')::boolean $$;
    CREATE TABLE users (id uuid PRIMARY KEY, vessel_id uuid, role text);
    CREATE TABLE vessels (id uuid PRIMARY KEY);
    CREATE TABLE vessel_subscriptions (
      id uuid DEFAULT gen_random_uuid(), vessel_id uuid UNIQUE, plan_tier text,
      billing_period text, status text, paddle_subscription_id text, paddle_customer_id text,
      payment_provider text, current_period_start timestamptz, current_period_end timestamptz,
      grace_period_end timestamptz, last_verified_at timestamptz,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE paddle_checkout_intents (
      id uuid PRIMARY KEY, vessel_id uuid, environment text, plan_tier text,
      billing_period text, transaction_id text, state text, previous_subscription_id text,
      price_id text, expected_customer_id text
    );
    CREATE TABLE paddle_subscription_links (
      subscription_id text PRIMARY KEY, checkout_id uuid, vessel_id uuid,
      customer_id text, environment text, provider_status text, last_event_at timestamptz, cancel_at timestamptz
    );
    CREATE TABLE paddle_processed_events (event_id text PRIMARY KEY, subscription_id text, occurred_at timestamptz);
    INSERT INTO vessels VALUES ('${vessel}'), ('${otherVessel}');
    INSERT INTO users VALUES ('${captain}', '${vessel}', 'CAPTAIN_MOV'),
      ('${crew}', '${vessel}', 'CREW'), ('${hod}', '${vessel}', 'HOD'), ('${outsider}', '${otherVessel}', 'CREW');
    INSERT INTO vessel_subscriptions (vessel_id, plan_tier, billing_period, status, payment_provider,
      current_period_start, current_period_end, paddle_subscription_id, paddle_customer_id)
      VALUES ('${vessel}', '1_5', 'monthly', 'trialing', 'paddle', now()-interval '30 days', now(), 'sub_test', 'ctm_test');
    INSERT INTO paddle_subscription_links(subscription_id, vessel_id, customer_id, environment, provider_status)
      VALUES ('sub_test', '${vessel}', 'ctm_test', 'live', 'trialing');
    GRANT USAGE ON SCHEMA auth TO authenticated;
  `);
      for (const table of [...modern, "tasks"]) {
        await db.exec(`CREATE TABLE ${ident(table)} (id uuid DEFAULT gen_random_uuid(), vessel_id uuid, note text);
      INSERT INTO ${ident(table)} (vessel_id,note) VALUES ('${vessel}','synthetic own vessel'), ('${otherVessel}','synthetic other vessel');`);
      }
      for (const name of [
        "vessel_subscription_allows_access",
        "current_user_can_access_vessel",
        "get_vessel_subscription_entitlement",
        "apply_paddle_subscription_event",
      ]) {
        await db.exec(
          snapshot.functions.find((f) => f.name === name).definition,
        );
      }
      for (const table of snapshot.tables) {
        if (table.rls)
          await db.exec(
            `ALTER TABLE ${ident(table.name)} ENABLE ROW LEVEL SECURITY`,
          );
        const grants = ["select", "insert", "update"].filter((g) => table[g]);
        await db.exec(
          `GRANT ${grants.join(",")} ON ${ident(table.name)} TO authenticated`,
        );
      }
      for (const p of snapshot.policies) {
        await db.exec(`CREATE POLICY ${ident(p.name)} ON ${ident(p.table)} AS ${p.permissive} FOR ${p.command}
      TO ${p.roles.map(ident).join(",")}${p.using ? ` USING (${p.using})` : ""}${p.check ? ` WITH CHECK (${p.check})` : ""}`);
      }
      // Prove the original defect using the captured live policies before fixing it.
      await isolated(async () => {
        await state("trialing", "now()");
        await asUser();
        assert.equal(await gate(), false);
        assert.equal(
          (await rows("tasks")).length,
          1,
          "Baseline must reproduce legacy expiry bypass",
        );
      });
      await db.exec(migration);
    });
    after(async () => {
      await db.close();
    });

    // Each test freezes PostgreSQL now() at BEGIN and rolls back all dummy changes.
    async function isolated(body) {
      await db.exec("BEGIN");
      try {
        await body();
      } finally {
        await db.exec("ROLLBACK");
      }
    }
    async function asUser(id = captain) {
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
        id,
      ]);
      await db.exec("SET LOCAL ROLE authenticated");
    }
    async function state(status, end, grace = "NULL") {
      await db.exec(
        `RESET ROLE; UPDATE vessel_subscriptions SET status='${status}', current_period_end=${end}, grace_period_end=${grace}`,
      );
    }
    async function gate() {
      return (
        await db.query("SELECT current_user_can_access_vessel($1) AS allowed", [
          vessel,
        ])
      ).rows[0].allowed;
    }
    async function rows(table) {
      return (await db.query(`SELECT * FROM ${ident(table)}`)).rows;
    }

    for (const [label, status, end, grace, expected] of [
      [
        "trial just before expiry",
        "trialing",
        "now()+interval '1 microsecond'",
        "NULL",
        true,
      ],
      ["trial at exact expiry", "trialing", "now()", "NULL", false],
      [
        "trial after expiry",
        "trialing",
        "now()-interval '1 microsecond'",
        "NULL",
        false,
      ],
      [
        "cancelled paid plan before paid-through deadline",
        "canceled",
        "now()+interval '1 microsecond'",
        "NULL",
        true,
      ],
      ["cancelled paid plan at deadline", "canceled", "now()", "NULL", false],
      [
        "first failed payment has no grace",
        "past_due",
        "now()+interval '30 days'",
        "now()",
        false,
      ],
      [
        "previously paid renewal inside grace",
        "past_due",
        "now()-interval '15 days'",
        "now()+interval '1 microsecond'",
        true,
      ],
      [
        "previously paid renewal at grace deadline",
        "past_due",
        "now()-interval '16 days'",
        "now()",
        false,
      ],
      [
        "revoked access despite future period",
        "revoked",
        "now()+interval '30 days'",
        "NULL",
        false,
      ],
      [
        "stale active state preserves access during provider uncertainty",
        "active",
        "now()-interval '1 day'",
        "NULL",
        true,
      ],
    ]) {
      test(label, () =>
        isolated(async () => {
          await state(status, end, grace);
          for (const user of [captain, crew, hod]) {
            await asUser(user);
            assert.equal(await gate(), expected);
            for (const table of protectedTables) {
              const visible = await rows(table);
              assert.equal(
                visible.length,
                expected ? 1 : 0,
                `${table}: ${user}`,
              );
              if (expected) assert.equal(visible[0].vessel_id, vessel);
            }
          }
        }),
      );
    }

    test("expired captain can read own safe plan status but not another vessel entitlement", () =>
      isolated(async () => {
        await state("trialing", "now()");
        await asUser();
        const own = (
          await db.query(
            "SELECT * FROM get_vessel_subscription_entitlement($1)",
            [vessel],
          )
        ).rows;
        assert.equal(own.length, 1);
        assert.equal("paddle_customer_id" in own[0], false);
        assert.equal(
          (
            await db.query(
              "SELECT * FROM get_vessel_subscription_entitlement($1)",
              [otherVessel],
            )
          ).rows.length,
          0,
        );
      }));

    test("expired protected-table writes denied, membership retained", () =>
      isolated(async () => {
        await state("trialing", "now()");
        await asUser();
        for (const table of protectedTables) {
          assert.equal(
            (
              await db.query(
                `UPDATE ${ident(table)} SET note='blocked' RETURNING id`,
              )
            ).rows.length,
            0,
          );
          await db.exec("SAVEPOINT denied_insert");
          await assert.rejects(
            db.query(
              `INSERT INTO ${ident(table)} (vessel_id,note) VALUES ($1,'blocked')`,
              [vessel],
            ),
            /row-level security/i,
          );
          await db.exec("ROLLBACK TO SAVEPOINT denied_insert");
        }
        assert.equal((await rows("users"))[0].vessel_id, vessel);
      }));

    test("outsider cannot read target-vessel legacy or modern records", () =>
      isolated(async () => {
        await state("active", "now()+interval '30 days'");
        await asUser(outsider);
        assert.equal(await gate(), false);
        for (const table of [...modern, "tasks"])
          assert.equal(
            (await rows(table)).some((r) => r.vessel_id === vessel),
            false,
          );
      }));

    test("verified subscription event restores modern-table access; duplicate and older events do not undo it", () =>
      isolated(async () => {
        await state("trialing", "now()-interval '1 second'");
        await asUser();
        assert.equal(await gate(), false);
        await db.exec("RESET ROLE");
        const now = (await db.query("SELECT now() AS n")).rows[0].n;
        const event = {
          event_id: "evt_paid",
          subscription_id: "sub_test",
          environment: "live",
          customer_id: "ctm_test",
          occurred_at: new Date(now).toISOString(),
          period_start: new Date(now).toISOString(),
          period_end: new Date(
            new Date(now).getTime() + 30 * 86400000,
          ).toISOString(),
          status: "active",
          plan_tier: "1_5",
          billing_period: "monthly",
        };
        const apply = async (e) =>
          (
            await db.query(
              "SELECT apply_paddle_subscription_event($1::jsonb) AS result",
              [JSON.stringify(e)],
            )
          ).rows[0].result;
        assert.equal(await apply(event), "applied");
        assert.equal(await apply(event), "duplicate");
        assert.equal(
          await apply({
            ...event,
            event_id: "evt_old",
            status: "trialing",
            occurred_at: new Date(new Date(now).getTime() - 1000).toISOString(),
          }),
          "stale",
        );
        await asUser();
        assert.equal(await gate(), true);
        for (const table of protectedTables)
          assert.equal((await rows(table)).length, 1);
      }));

    test("REGRESSION: expired vessel member must not read legacy tasks", () =>
      isolated(async () => {
        await state("trialing", "now()");
        await asUser();
        assert.equal(await gate(), false);
        assert.equal(
          (await rows("tasks")).length,
          0,
          "Legacy membership-only policy still exposes the own-vessel dummy task after expiry",
        );
      }));

    test("active captain, crew and HOD retain legacy insert/update, but cannot move a task to another vessel", () =>
      isolated(async () => {
        await state("active", "now()+interval '30 days'");
        for (const user of [captain, crew, hod]) {
          await asUser(user);
          const inserted = (
            await db.query(
              "INSERT INTO tasks(vessel_id,note) VALUES ($1,'allowed') RETURNING id",
              [vessel],
            )
          ).rows[0];
          assert.equal(
            (
              await db.query(
                "UPDATE tasks SET note='updated' WHERE id=$1 RETURNING id",
                [inserted.id],
              )
            ).rows.length,
            1,
          );
          await db.exec("SAVEPOINT cross_vessel_update");
          await assert.rejects(
            db.query("UPDATE tasks SET vessel_id=$1 WHERE id=$2", [
              otherVessel,
              inserted.id,
            ]),
            /row-level security/i,
          );
          await db.exec("ROLLBACK TO SAVEPOINT cross_vessel_update");
          await db.exec("SAVEPOINT cross_vessel_insert");
          await assert.rejects(
            db.query(
              "INSERT INTO tasks(vessel_id,note) VALUES ($1,'blocked')",
              [otherVessel],
            ),
            /row-level security/i,
          );
          await db.exec("ROLLBACK TO SAVEPOINT cross_vessel_insert");
        }
      }));

    test("invalid device cannot read or insert legacy tasks even with active subscription", () =>
      isolated(async () => {
        await state("active", "now()+interval '30 days'");
        await db.exec("SET LOCAL test.device_access='false'");
        await asUser();
        assert.equal((await rows("tasks")).length, 0);
        await assert.rejects(
          db.query("INSERT INTO tasks(vessel_id,note) VALUES ($1,'blocked')", [
            vessel,
          ]),
          /row-level security/i,
        );
      }));

    test("anonymous legacy access remains denied even when table privileges exist", () =>
      isolated(async () => {
        await db.exec(
          "GRANT SELECT, INSERT ON tasks TO anon; SET LOCAL ROLE anon",
        );
        assert.equal((await rows("tasks")).length, 0);
        await assert.rejects(
          db.query("INSERT INTO tasks(vessel_id,note) VALUES ($1,'blocked')", [
            vessel,
          ]),
          /row-level security/i,
        );
      }));

    test("migration does not introduce a legacy delete policy", () =>
      isolated(async () => {
        await state("active", "now()+interval '30 days'");
        await db.exec("GRANT DELETE ON tasks TO authenticated");
        await asUser();
        assert.equal(
          (await db.query("DELETE FROM tasks RETURNING id")).rows.length,
          0,
        );
        assert.equal((await rows("tasks")).length, 1);
      }));
  },
);
