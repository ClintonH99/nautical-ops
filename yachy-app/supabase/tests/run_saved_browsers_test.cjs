// Disposable PostgreSQL-compatible database only; never contacts production.
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
    for (const name of ['20260903151000_ENFORCE_TWO_DEVICE_LIMIT.sql', '20261002130000_STRICT_SENSITIVE_ACTION_DEVICE_CHECK.sql',
      '20261002140000_DEVICE_MANAGEMENT_AND_RECOVERY.sql','20261008141000_ENFORCE_REGISTERED_WEB_SESSIONS.sql',
      '20261015120000_ACTIVE_BROWSER_SESSION_LEASES.sql']) await db.exec(read(`migrations/${name}`));
    await db.exec(`GRANT USAGE ON SCHEMA public,auth TO authenticated; INSERT INTO auth.users(id) VALUES ('${id(1)}'),('${id(2)}');
      CREATE TABLE public.saved_protected_records(id int); INSERT INTO public.saved_protected_records VALUES(1);
      ALTER TABLE public.saved_protected_records ENABLE ROW LEVEL SECURITY;
      CREATE POLICY saved_guard ON public.saved_protected_records FOR SELECT TO authenticated USING(public.current_session_has_device_access());
      GRANT SELECT ON public.saved_protected_records TO authenticated;`);
    const as = async (user, session, sql, amr=[]) => {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
        [id(user),JSON.stringify({session_id:id(session),amr})]);
      await db.exec('SET ROLE authenticated');
      try { return (await db.query(sql)).rows; } finally { await db.exec('RESET ROLE'); }
    };
    const register = async (session,browser,user=1) => (await as(user,session,
      `SELECT register_user_device('browser-fingerprint-${browser}','web','Test ${browser}') AS result`))[0].result;
    const count = async (user=1) => (await db.query(`SELECT count(*)::int n FROM user_devices WHERE user_id='${id(user)}' AND revoked_at IS NULL`)).rows[0].n;
    const records = async (session,user=1) => (await as(user,session,'SELECT * FROM saved_protected_records')).length;
    await register(11,'A'); await register(12,'B');
    await register(21,'old',2);
    await db.exec(`INSERT INTO browser_session_rollout VALUES('${id(2)}',true);
      UPDATE user_devices SET last_seen_at=now()-interval '2 hours' WHERE user_id='${id(2)}';`);
    await db.exec(read('migrations/20261015150000_PERSISTENT_SAVED_BROWSERS.sql'));
    equal(await count(),2); // Legacy registrations preserved.
    equal(await count(2),0); // Already-expired experimental record not resurrected.
    equal((await db.query('SELECT count(*)::int n FROM user_devices')).rows[0].n,3); // History preserved.
    const result=await register(11,'A');
    equal(result.mode,'saved_browsers'); equal(result.allowed,true);
    equal(result.lease_expires_at,undefined);
    for(let i=0;i<100;i++) equal((await register(11,'A')).active_device_count,2);
    equal((await register(13,'C')).reason,'saved_browser_limit');
    equal(await records(13),0); equal(await records(11),1); equal(await records(11,2),0);
    // No inactivity expiry, even if historical timestamps are arbitrarily old.
    await db.exec("UPDATE user_devices SET last_seen_at=now()-interval '10 years',lease_expires_at=now()-interval '10 years'");
    equal(await records(11),1); equal((await register(13,'C')).allowed,false);
    equal((await as(1,13,'SELECT * FROM list_active_browser_sessions()')).length,2);
    equal((await as(1,13,'SELECT * FROM list_active_browser_sessions()')).some(x=>'device_fingerprint' in x || 'session_id' in x),false);
    await assert.rejects(as(1,13,'SELECT * FROM list_account_devices()')); checks++;
    // Sign-out releases exactly one slot and is safe to retry.
    equal((await as(1,11,'SELECT revoke_current_device() result'))[0].result,true);
    equal((await as(1,11,'SELECT revoke_current_device() result'))[0].result,true);
    equal(await count(),1); equal(await records(11),0); equal(await records(12),1);
    equal((await register(11,'A')).reason,'session_revoked'); // Late heartbeat cannot undo logout.
    equal((await register(13,'C')).allowed,true); equal(await count(),2);
    // Same installation with a fresh authenticated login reuses its row.
    equal((await register(14,'C')).allowed,true); equal(await count(),2);
    equal(await records(13),0); equal(await records(14),1);
    const devices=await as(1,14,'SELECT * FROM list_account_devices()');
    const other=devices.find(x=>!x.is_current);
    await assert.rejects(as(2,22,`SELECT remove_account_device('${other.id}')`)); checks++;
    await as(1,14,`SELECT remove_account_device('${other.id}')`);
    equal(await count(),1); equal(await records(12),0);
    equal((await register(12,'B')).reason,'session_revoked');
    // Serialized contenders: exactly one remaining slot can be claimed.
    const contenders=[];
    for(let i=0;i<10;i++) contenders.push(await register(100+i,`contender-${i}`));
    equal(contenders.filter(x=>x.allowed).length,1); equal(await count(),2);
    // Recovery requires password + recent OTP, replaces atomically, retries idempotently.
    const stamp=Math.floor(Date.now()/1000);
    const challenge=(await as(1,201,'SELECT begin_device_recovery() id',[{method:'password',timestamp:stamp}]))[0].id;
    const otp=[{method:'otp',timestamp:stamp+1}];
    const replace=(await as(1,202,`SELECT * FROM list_account_devices('${challenge}')`,otp))[0].id;
    await assert.rejects(as(1,202,`SELECT complete_device_recovery('${challenge}',ARRAY[]::uuid[],'browser-fingerprint-recovery','web','Recovery')`,otp)); checks++;
    equal(await count(),2);
    // Failed registration rolls removal back.
    await assert.rejects(as(1,202,`SELECT complete_device_recovery('${challenge}',ARRAY['${replace}']::uuid[],'short','web','Recovery')`,otp)); checks++;
    equal(await count(),2);
    for(let i=0;i<2;i++) equal((await as(1,202,`SELECT complete_device_recovery('${challenge}',ARRAY['${replace}']::uuid[],'browser-fingerprint-recovery','web','Recovery') result`,otp))[0].result.allowed,true);
    equal(await count(),2); equal(await records(202),1);
    await assert.rejects(as(1,202,'UPDATE user_devices SET revoked_at=NULL')); checks++;
    equal((await db.query("SELECT has_function_privilege('anon','public.list_active_browser_sessions()','EXECUTE') allowed")).rows[0].allowed,false);
    equal((await db.query("SELECT has_function_privilege('authenticated','public.register_user_device_internal(text,text,text)','EXECUTE') allowed")).rows[0].allowed,false);
    console.log(`${checks} saved-browser assertions passed (serialized engine; not a multi-connection stress test).`);
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
