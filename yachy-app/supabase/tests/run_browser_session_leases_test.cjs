// Disposable PostgreSQL engine only. Never connects to Supabase/production.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let checks = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
(async () => {
  const db = new PGlite();
  try {
    await db.exec(read('tests/minimal_foundation_schema.sql').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
    await db.exec(read('tests/local_auth_bootstrap.sql').replace(/^\\.*$/gm, ''));
    for (const name of [
      '20260903151000_ENFORCE_TWO_DEVICE_LIMIT.sql',
      '20261002130000_STRICT_SENSITIVE_ACTION_DEVICE_CHECK.sql',
      '20261002140000_DEVICE_MANAGEMENT_AND_RECOVERY.sql',
      '20261008141000_ENFORCE_REGISTERED_WEB_SESSIONS.sql',
      '20261015120000_ACTIVE_BROWSER_SESSION_LEASES.sql',
    ]) await db.exec(read(`migrations/${name}`));
    await db.exec(`GRANT USAGE ON SCHEMA public,auth TO authenticated;
      INSERT INTO auth.users(id) VALUES ('${id(1)}'),('${id(2)}');
      CREATE TABLE public.lease_protected_records(id int);
      INSERT INTO public.lease_protected_records VALUES (1);
      ALTER TABLE public.lease_protected_records ENABLE ROW LEVEL SECURITY;
      CREATE POLICY lease_guard ON public.lease_protected_records FOR SELECT TO authenticated
        USING (public.current_session_has_device_access());
      GRANT SELECT ON public.lease_protected_records TO authenticated;`);
    const as = async (user, session, sql, amr = []) => {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
        [user ? id(user) : '', JSON.stringify({ session_id: session ? id(session) : undefined, amr })]);
      await db.exec('SET ROLE authenticated');
      try { return (await db.query(sql)).rows; } finally { await db.exec('RESET ROLE'); }
    };
    const register = async (session, browser, user = 1) => (await as(user, session,
      `SELECT register_user_device('browser-fingerprint-${browser}','web','Test browser ${browser}') AS result`))[0].result;
    const authorized = async (session, user = 1) => (await as(user, session,
      'SELECT current_session_has_registered_device() AS allowed'))[0].allowed;
    const count = async () => (await db.query(`SELECT count(*)::int AS n FROM user_devices
      WHERE user_id='${id(1)}' AND revoked_at IS NULL AND lease_expires_at>now()`)).rows[0].n;

    equal((await db.query('SELECT count(*)::int AS n FROM browser_session_rollout')).rows[0].n, 0);
    equal((await register(11, 'A')).allowed, true);
    equal((await register(12, 'B')).allowed, true);
    equal((await register(13, 'C')).allowed, false); // legacy unchanged
    await db.exec(`INSERT INTO browser_session_rollout VALUES ('${id(1)}',true)`);
    const first = await register(11, 'A');
    equal(first.mode, 'active_sessions');
    equal(Date.parse(first.lease_expires_at) - Date.parse(first.server_time), 3600000);
    await register(12, 'B');
    for (let i = 0; i < 100; i++) equal((await register(11, 'A')).active_device_count, 2);
    equal(await count(), 2);
    equal((await register(13, 'C')).allowed, false);
    equal(await authorized(13), false);
    equal(await authorized(11, 2), false); // ownership enforced
    equal((await as(1, 13, 'SELECT * FROM lease_protected_records')).length, 0);
    equal((await as(1, 11, 'SELECT * FROM lease_protected_records')).length, 1);

    // Simulate time passing without any auth logout or session revocation.
    await db.exec(`UPDATE user_devices SET lease_expires_at=now()-INTERVAL '1 second'
      WHERE user_id='${id(1)}' AND device_fingerprint='browser-fingerprint-A'`);
    equal(await authorized(11), false);
    equal((await as(1, 11, 'SELECT * FROM lease_protected_records')).length, 0);
    equal((await db.query('SELECT count(*)::int AS n FROM revoked_device_sessions')).rows[0].n, 0);
    equal((await register(13, 'C')).allowed, true);
    equal((await register(11, 'A')).reason, 'active_session_limit');
    equal(await count(), 2);
    equal((await as(1, 11, 'SELECT * FROM list_active_browser_sessions()')).length, 2);
    equal((await as(1, 11, 'SELECT * FROM list_active_browser_sessions()')).some(row => 'session_id' in row || 'device_fingerprint' in row), false);
    await assert.rejects(as(1, 11, 'SELECT * FROM list_account_devices()'));
    await assert.rejects(as(1, 11, `SELECT remove_account_device((SELECT id FROM list_active_browser_sessions() LIMIT 1))`));
    // An active user can end another session, but not another account's.
    const cId = (await db.query("SELECT id FROM user_devices WHERE device_fingerprint='browser-fingerprint-C'")).rows[0].id;
    await as(1, 12, `SELECT remove_account_device('${cId}')`);
    equal(await authorized(13), false);
    equal((await register(13, 'C')).reason, 'session_revoked');
    equal((await register(11, 'A')).allowed, true); // original auth session reused
    equal(await count(), 2);

    // Expiry and failed renewal never create a third active slot.
    await db.exec(`UPDATE user_devices SET lease_expires_at=now()-INTERVAL '1 second'
      WHERE user_id='${id(1)}' AND device_fingerprint='browser-fingerprint-B'`);
    const attempts = [];
    // PGlite is single-connection: this verifies serialized outcomes, not a
    // multi-connection advisory-lock stress test (required before rollout).
    for (let i = 0; i < 10; i++) attempts.push(await register(100 + i, `parallel-${i}`));
    equal(attempts.filter(result => result.allowed).length, 1);
    equal(await count(), 2);
    // One browser multiple tabs sharing a session: retries are idempotent.
    equal((await register(11, 'A')).allowed, true);
    equal(await count(), 2);

    // Recovery removes and claims atomically, authenticated by password + OTP.
    const stamp = Math.floor(Date.now()/1000);
    const challenge = (await as(1, 201, 'SELECT begin_device_recovery() AS id', [{method:'password', timestamp:stamp}]))[0].id;
    const otp = [{method:'otp', timestamp:stamp+1}];
    const toRemove = (await as(1, 202, `SELECT * FROM list_account_devices('${challenge}')`, otp))[0].id;
    equal((await as(1, 202, `SELECT complete_device_recovery('${challenge}',ARRAY['${toRemove}']::uuid[],
      'browser-fingerprint-recovery','web','Recovered') AS result`, otp))[0].result.allowed, true);
    equal(await count(), 2);
    equal((await as(1, 202, `SELECT complete_device_recovery('${challenge}',ARRAY['${toRemove}']::uuid[],
      'browser-fingerprint-recovery','web','Recovered') AS result`, otp))[0].result.allowed, true);
    equal(await count(), 2);

    // No authenticated user can enable themselves or update their expiry.
    await assert.rejects(as(1, 202, `INSERT INTO browser_session_rollout VALUES ('${id(2)}',true)`));
    await assert.rejects(as(1, 202, 'UPDATE user_devices SET lease_expires_at=now()+interval \'1 year\''));
    equal((await db.query("SELECT has_function_privilege('anon','public.list_active_browser_sessions()','EXECUTE') AS allowed")).rows[0].allowed, false);
    equal((await db.query("SELECT has_function_privilege('authenticated','public.register_user_device_internal(text,text,text)','EXECUTE') AS allowed")).rows[0].allowed, false);
    console.log(`${checks} lease assertions passed. No production data accessed. Multi-connection stress test still required.`);
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
