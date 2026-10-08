// Disposable PostgreSQL; never connects to Supabase/live billing.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const read = (file) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
(async () => {
  const db = new PGlite();
  let checks = 0;
  const equal = (a, b) => {
    assert.deepEqual(a, b);
    checks++;
  };
  const rejects = async (fn, pattern) => {
    await assert.rejects(fn, pattern);
    checks++;
  };
  const asUser = async (user, fn) => {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uuid(user)]);
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
    await db.exec(`ALTER TABLE vessel_subscriptions ADD COLUMN paddle_customer_id TEXT;
      CREATE FUNCTION public.current_session_has_device_access() RETURNS BOOLEAN LANGUAGE SQL STABLE
        AS $$ SELECT COALESCE(current_setting('test.device_allowed', true),'yes') <> 'no' $$;
      GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;`);
    await db.exec(read('supabase/migrations/20261002100000_PADDLE_WEB_BILLING_FOUNDATION.sql'));
    await db.exec(read('supabase/migrations/20261007150000_PADDLE_CARDLESS_TRIAL_RESERVATION.sql'));
    await db.exec(`INSERT INTO vessels(id,name,invite_code) VALUES('${uuid(1)}','A','A'),('${uuid(2)}','B','B');
      INSERT INTO users(id,vessel_id,role) VALUES('${uuid(10)}','${uuid(1)}','CAPTAIN_MOV'),('${uuid(11)}','${uuid(1)}','HOD'),('${uuid(12)}','${uuid(1)}','CREW'),('${uuid(13)}','${uuid(2)}','CAPTAIN_MOV');`);
    const reserve = (user = 10, tier = '1_5') =>
      asUser(user, () =>
        db.query(`SELECT reserve_paddle_checkout($1,$2,'monthly','sandbox','pri_test') AS intent`, [
          uuid(1),
          tier,
        ])
      );
    await rejects(() => reserve(11), /Captain/);
    await rejects(() => reserve(12), /Captain/);
    await rejects(() => reserve(13), /Captain/);
    await db.exec("SELECT set_config('test.device_allowed','no',false)");
    await rejects(() => reserve(), /registered device/);
    await db.exec("SELECT set_config('test.device_allowed','yes',false)");
    const intent = (await reserve()).rows[0].intent;
    equal(intent.created, true);
    equal((await reserve()).rows[0].intent.created, false);
    await rejects(() => reserve(10, '6_10'), /existing checkout/);
    await rejects(
      () => asUser(10, () => db.query('SELECT * FROM paddle_checkout_intents')),
      /permission denied/
    );
    const base = {
      event_id: 'evt_1',
      occurred_at: '2030-01-01T00:00:00Z',
      environment: 'sandbox',
      subscription_id: 'sub_1',
      customer_id: 'ctm_1',
      checkout_id: intent.id,
      transaction_id: 'txn_1',
      plan_tier: '1_5',
      billing_period: 'monthly',
      status: 'active',
      period_start: '2030-01-01T00:00:00Z',
      period_end: '2030-02-01T00:00:00Z',
      cancel_at: null,
    };
    const apply = (event) =>
      db.query('SELECT apply_paddle_subscription_event($1::jsonb) AS result', [
        JSON.stringify(event),
      ]);
    await rejects(() => asUser(10, () => apply(base)), /permission denied/);
    await rejects(() => apply(base), /verified checkout/);
    await db.query(
      "UPDATE paddle_checkout_intents SET state='ready',transaction_id='txn_1' WHERE id=$1",
      [intent.id]
    );
    await rejects(() => apply({ ...base, transaction_id: 'txn_forged' }), /verified checkout/);
    equal((await apply(base)).rows[0].result, 'applied');
    equal((await apply(base)).rows[0].result, 'duplicate');
    const row = async () =>
      (await db.query('SELECT * FROM vessel_subscriptions WHERE vessel_id=$1', [uuid(1)])).rows[0];
    equal((await row()).payment_provider, 'paddle');
    await rejects(() => reserve(), /existing subscription/);
    equal(
      (
        await apply({
          ...base,
          event_id: 'evt_old',
          occurred_at: '2029-12-01T00:00:00Z',
          status: 'paused',
        })
      ).rows[0].result,
      'stale'
    );
    equal((await row()).status, 'active');
    await rejects(
      () =>
        apply({
          ...base,
          event_id: 'evt_wrong_env',
          environment: 'live',
          occurred_at: '2030-01-02T00:00:00Z',
        }),
      /binding mismatch/
    );
    await apply({
      ...base,
      event_id: 'evt_cancel',
      occurred_at: '2030-01-03T00:00:00Z',
      cancel_at: '2030-02-01T00:00:00Z',
    });
    equal((await row()).status, 'canceled');
    equal(new Date((await row()).current_period_end).toISOString(), '2030-02-01T00:00:00.000Z');
    await apply({ ...base, event_id: 'evt_resume', occurred_at: '2030-01-04T00:00:00Z' });
    equal((await row()).status, 'active');
    const overdue = {
      ...base,
      event_id: 'evt_due',
      occurred_at: '2030-02-01T00:00:00Z',
      status: 'past_due',
      period_start: '2030-02-01T00:00:00Z',
      period_end: '2030-03-01T00:00:00Z',
    };
    await apply(overdue);
    equal(new Date((await row()).grace_period_end).toISOString(), '2030-02-17T00:00:00.000Z');
    await apply({ ...overdue, event_id: 'evt_due_repeat', occurred_at: '2030-02-05T00:00:00Z' });
    equal(new Date((await row()).grace_period_end).toISOString(), '2030-02-17T00:00:00.000Z');
    await apply({
      ...base,
      event_id: 'evt_pause',
      occurred_at: '2030-02-06T00:00:00Z',
      status: 'paused',
      period_start: null,
      period_end: null,
    });
    equal((await row()).status, 'revoked');
    await apply({ ...base, event_id: 'evt_recovered', occurred_at: '2030-02-07T00:00:00Z' });
    equal((await row()).grace_period_end, null);
    // A failed entitlement write must roll back event deduplication and link state.
    await db.exec(`CREATE FUNCTION fail_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated failure'; END $$;
      CREATE TRIGGER fail_test BEFORE UPDATE ON vessel_subscriptions FOR EACH ROW EXECUTE FUNCTION fail_test();`);
    const retry = { ...base, event_id: 'evt_retry', occurred_at: '2030-02-08T00:00:00Z' };
    await rejects(() => apply(retry), /simulated failure/);
    equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM paddle_processed_events WHERE event_id='evt_retry'"
        )
      ).rows[0].n,
      0
    );
    await db.exec('DROP TRIGGER fail_test ON vessel_subscriptions');
    equal((await apply(retry)).rows[0].result, 'applied');
    // Cardless-trial permissions, duplicate prevention and payment lookup.
    await db.exec(`INSERT INTO vessels(id,name,invite_code) VALUES('${uuid(3)}','Trial','TRIAL');
      INSERT INTO users(id,vessel_id,role) VALUES('${uuid(20)}','${uuid(3)}','CAPTAIN_MOV');`);
    const trial = (user = 20) =>
      asUser(user, () =>
        db.query(`SELECT reserve_paddle_trial($1,'1_5','monthly','pri_test') AS intent`, [uuid(3)])
      );
    for (const user of [10, 11, 12, 13]) await rejects(() => trial(user), /Captain/);
    await db.exec("SELECT set_config('test.device_allowed','no',false)");
    await rejects(() => trial(), /registered device/);
    await db.exec("SELECT set_config('test.device_allowed','yes',false)");
    const trialIntent = (await trial()).rows[0].intent;
    equal(trialIntent.created, true);
    equal((await trial()).rows[0].intent.created, false);
    const lookup = (user = 20) =>
      asUser(user, () => db.query('SELECT get_paddle_trial_billing($1) AS billing', [uuid(3)]));
    await rejects(() => lookup(), /confirmed/);
    await db.query(
      "UPDATE paddle_checkout_intents SET state='ready',transaction_id='txn_trial' WHERE id=$1",
      [trialIntent.id]
    );
    await apply({
      ...base,
      event_id: 'evt_trial',
      subscription_id: 'sub_trial',
      checkout_id: trialIntent.id,
      transaction_id: 'txn_trial',
      status: 'trialing',
      period_start: '2099-01-01T00:00:00Z',
      period_end: '2099-01-31T00:00:00Z',
    });
    equal((await lookup()).rows[0].billing.subscription_id, 'sub_trial');
    await rejects(() => lookup(10), /Captain/);
    await rejects(() => trial(), /second trial/);
    await db.exec(`UPDATE vessel_subscriptions SET status='canceled' WHERE vessel_id='${uuid(3)}'`);
    await rejects(() => lookup(), /confirmed/);
    await rejects(() => trial(), /second trial/);
    console.log(`${checks} Paddle database checks passed`);
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
