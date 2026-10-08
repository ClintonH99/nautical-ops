// Local disposable PostgreSQL only; never connects to a live database.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const sql = fs.readFileSync(
  path.resolve(__dirname, '../operations/archive_john_doe_apple_test.sql'),
  'utf8'
);
const id = 'b442bec0-3a37-401f-9780-859dd4a83622';
const vessel = '2ac4d294-90f5-42f9-ab0e-44d19abd0d61';
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE vessel_subscriptions (
        id uuid PRIMARY KEY, vessel_id uuid UNIQUE, payment_provider text, status text,
        current_period_end timestamptz, updated_at timestamptz, paddle_subscription_id text,
        apple_original_transaction_id text
      );
      INSERT INTO vessel_subscriptions VALUES (
        '${id}', '${vessel}', 'apple', 'active', '2026-07-29 18:52:27+00',
        '2026-07-28 18:58:25.741+00', NULL, 'test-only-transaction'
      );
      INSERT INTO vessel_subscriptions VALUES (
        '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
        'paddle', 'active', '2099-01-01', now(), 'sub_keep', NULL
      );`);
    const before = (
      await db.query('SELECT to_jsonb(s) AS snapshot FROM vessel_subscriptions s WHERE id=$1', [id])
    ).rows[0].snapshot;
    await db.exec(
      "UPDATE vessel_subscriptions SET status='canceled' WHERE payment_provider='apple'"
    );
    await assert.rejects(() => db.exec(sql), /changed since inspection/);
    await db.exec('ROLLBACK');
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM vessel_subscriptions')).rows[0].n,
      2
    );
    await db.exec("UPDATE vessel_subscriptions SET status='active' WHERE payment_provider='apple'");
    // A failed delete must also roll back the archive, never leave a partial move.
    await db.exec(`CREATE FUNCTION fail_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated failure'; END $$;
      CREATE TRIGGER fail_delete BEFORE DELETE ON vessel_subscriptions
      FOR EACH ROW EXECUTE FUNCTION fail_delete();`);
    await assert.rejects(() => db.exec(sql), /simulated failure/);
    await db.exec('ROLLBACK; DROP TRIGGER fail_delete ON vessel_subscriptions;');
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM vessel_subscriptions')).rows[0].n,
      2
    );
    await db.exec(sql);
    assert.deepEqual(
      (await db.query('SELECT snapshot FROM vessel_subscription_cutover_archive')).rows[0].snapshot,
      before
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM vessel_subscriptions')).rows[0].n,
      1
    );
    await db.exec(sql); // Retry is safe.
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM vessel_subscription_cutover_archive')).rows[0]
        .n,
      1
    );
    await db.exec('SET ROLE authenticated');
    await assert.rejects(
      () => db.query('SELECT * FROM vessel_subscription_cutover_archive'),
      /permission denied/
    );
    await db.exec('RESET ROLE; SET ROLE anon');
    await assert.rejects(
      () => db.query('SELECT * FROM vessel_subscription_cutover_archive'),
      /permission denied/
    );
    await db.exec('RESET ROLE');
    // Demonstrate full recovery without overwriting any new subscription.
    await db.exec(`INSERT INTO vessel_subscriptions
      SELECT (jsonb_populate_record(NULL::vessel_subscriptions, snapshot)).*
      FROM vessel_subscription_cutover_archive WHERE subscription_id='${id}';`);
    assert.deepEqual(
      (
        await db.query('SELECT to_jsonb(s) AS snapshot FROM vessel_subscriptions s WHERE id=$1', [
          id,
        ])
      ).rows[0].snapshot,
      before
    );
    console.log(
      'Subscription cutover passed: exact snapshot, scope, changed-row guard, rollback, retry, private archive, recovery.'
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
