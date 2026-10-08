// Isolated SQL regression: never connects to production or sends emails.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let checks = 0;
const equal = (a,b) => { assert.deepEqual(a,b); checks++; };
(async () => {
  const db = new PGlite();
  const as = async (user, session, sql, method = 'password') => {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [user ? id(user) : '', JSON.stringify({session_id: session ? id(session) : null,
        amr:[{method,timestamp:Math.floor(Date.now()/1000)}]})]);
    await db.exec(`SET ROLE ${user ? 'authenticated' : 'anon'}`);
    try { return (await db.query(sql)).rows; } finally { await db.exec('RESET ROLE'); }
  };
  const denied = async (user, session, sql, pattern = /permission denied|row-level security/) => {
    await assert.rejects(() => as(user, session, sql), pattern); checks++;
  };
  const register = (session, fingerprint = `web-security-browser-${session}`) =>
    as(10, session, `SELECT register_user_device('${fingerprint}','web','Test browser') AS result`);
  try {
    await db.exec(read('tests/minimal_foundation_schema.sql').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
    await db.exec(read('tests/local_auth_bootstrap.sql').replace(/^\\.*$/gm,''));
    await db.exec(`ALTER TABLE vessel_subscriptions ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
      ALTER TABLE vessels ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
      ALTER TABLE users ADD COLUMN rotation_group_id UUID, ADD COLUMN paused BOOLEAN DEFAULT FALSE;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
      GRANT SELECT ON vessels,vessel_subscriptions,users TO anon,authenticated;
      GRANT INSERT ON users,vessels TO authenticated;
      ALTER TABLE vessels ENABLE ROW LEVEL SECURITY;
      ALTER TABLE vessel_subscriptions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE users ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Own profile bootstrap" ON users FOR SELECT TO authenticated USING (id=auth.uid());
      INSERT INTO auth.users(id) VALUES ('${id(10)}'),('${id(11)}');
      INSERT INTO vessels(id,name,invite_code,invite_expiry) VALUES
        ('${id(1)}','Test A','INVITEAA',now()+INTERVAL '1 day'),
        ('${id(2)}','Test B','INVITEBB',now()+INTERVAL '1 day');
      INSERT INTO users(id,vessel_id,role) VALUES ('${id(10)}','${id(1)}','CREW');
      INSERT INTO vessel_subscriptions(vessel_id,plan_tier,status,current_period_end) VALUES
        ('${id(1)}','1_5','active',now()+INTERVAL '1 month'),
        ('${id(2)}','1_5','active',now()+INTERVAL '1 month');`);
    for (const name of ['20260903151000_ENFORCE_TWO_DEVICE_LIMIT.sql',
      '20261002130000_STRICT_SENSITIVE_ACTION_DEVICE_CHECK.sql',
      '20261002140000_DEVICE_MANAGEMENT_AND_RECOVERY.sql']) await db.exec(read('migrations/'+name));
    const source = read('migrations/20260903152000_SERVER_SIDE_ACCESS_ENFORCEMENT.sql');
    for (const name of ['vessel_subscription_allows_access','current_user_can_access_vessel',
      'validate_vessel_invite_code','get_vessel_subscription_entitlement']) {
      await db.exec(source.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$\\$;'))[0]);
    }
    for (const name of ['Legacy app validates invites before enforcement activation',
      'Legacy app reads own subscription before enforcement activation',
      'Legacy app can create vessels before enforcement activation',
      'Users create only their own unassigned profile','Members can read their active vessel']) {
      await db.exec(source.match(new RegExp('CREATE POLICY "'+name+'"[\\s\\S]*?;'))[0]);
    }
    await db.exec(read('migrations/20260910170000_CLEAN_UP_SOLO_VESSEL_ON_JOIN.sql'));
    // First reproduce the actual anonymous disclosure with the rollout off.
    equal((await as(null,null,'SELECT invite_code FROM vessels')).length,2);
    equal((await as(null,null,'SELECT status FROM vessel_subscriptions')).length,2);
    const closeReads = read('migrations/20261008140000_CLOSE_ANONYMOUS_VESSEL_READS.sql');
    const strict = read('migrations/20261008141000_ENFORCE_REGISTERED_WEB_SESSIONS.sql');
    await db.exec(closeReads);
    for (const table of ['vessels','vessel_subscriptions']) await denied(null,null,`SELECT * FROM ${table}`);
    // Even accidental broad grants/permissive policies cannot reopen anon reads.
    await db.exec(`GRANT SELECT ON vessels,vessel_subscriptions TO anon;
      CREATE POLICY accidental_vessels ON vessels FOR SELECT TO anon USING(TRUE);
      CREATE POLICY accidental_subscriptions ON vessel_subscriptions FOR SELECT TO anon USING(TRUE);`);
    equal((await as(null,null,'SELECT * FROM vessels')).length,0);
    equal((await as(null,null,'SELECT * FROM vessel_subscriptions')).length,0);
    equal(Object.keys((await as(null,null,"SELECT validate_vessel_invite_code('INVITEAA') AS v"))[0].v).sort(),['id','name']);
    await denied(null,null,"SELECT validate_vessel_invite_code('BADCODE')",/Invalid invite/);
    await db.exec(`UPDATE vessels SET invite_expiry=now()-INTERVAL '1 day' WHERE id='${id(2)}'`);
    await denied(null,null,"SELECT validate_vessel_invite_code('INVITEBB')",/expired/);
    await db.exec(strict);
    equal((await db.query('SELECT enabled FROM security_enforcement_settings')).rows[0].enabled,true);
    // Turning the old flag off again must not bypass the new guard.
    for (const enabled of [false,true]) {
      await db.exec(`UPDATE security_enforcement_settings SET enabled=${enabled}`);
      equal((await as(10,100,'SELECT current_session_has_device_access() AS allowed'))[0].allowed,false);
      equal((await as(10,100,'SELECT id FROM vessels')).length,0);
      equal((await as(10,100,`SELECT * FROM get_vessel_subscription_entitlement('${id(1)}')`)).length,0);
    }
    await denied(null,null,'SELECT current_session_has_device_access()');
    await denied(10,100,"SELECT register_user_device_internal('bypass-fingerprint','web','Bypass')");
    await denied(10,100,`INSERT INTO vessels(name,invite_code) VALUES ('Bypass','BYPASS01')`);
    await denied(11,110,`INSERT INTO users(id,vessel_id,role) VALUES ('${id(11)}','${id(1)}','CAPTAIN_MOV')`);
    await as(11,110,`INSERT INTO users(id,role) VALUES ('${id(11)}','CREW')`);
    await denied(11,110,"SELECT join_current_user_to_vessel('INVITEAA')",/device is not authorized/);
    await as(11,110,"SELECT register_user_device('new-crew-browser-fingerprint','web','New crew')");
    equal((await as(11,110,"SELECT join_current_user_to_vessel('INVITEAA') AS vessel"))[0].vessel.id,id(1));
    equal((await as(11,110,'SELECT id FROM vessels')).map(r=>r.id),[id(1)]);
    await denied(null,null,"SELECT validate_vessel_invite_code('INVITEAA')",/Invalid invite/);
    equal((await register(100))[0].result.allowed,true);
    equal((await register(101))[0].result.allowed,true);
    equal((await register(102))[0].result.allowed,false);
    equal((await as(10,100,'SELECT id FROM vessels')).map(r=>r.id),[id(1)]);
    equal((await as(10,100,`SELECT * FROM get_vessel_subscription_entitlement('${id(1)}')`)).length,1);
    equal((await as(10,100,`SELECT * FROM get_vessel_subscription_entitlement('${id(2)}')`)).length,0);
    await denied(10,100,'SELECT * FROM vessel_subscriptions');
    const device = (await db.query(`SELECT id FROM user_devices WHERE session_id='${id(101)}'`)).rows[0].id;
    await as(10,100,`SELECT remove_account_device('${device}')`);
    equal((await as(10,101,'SELECT id FROM vessels')).length,0);
    equal((await register(101))[0].result.reason,'session_revoked');
    equal((await register(101,'changed-device-fingerprint'))[0].result.reason,'session_revoked');
    equal((await register(102))[0].result.allowed,true);
    // A fresh login for the same installation replaces, not duplicates, its slot.
    equal((await register(103,'web-security-browser-102'))[0].result.allowed,true);
    equal((await register(102))[0].result.reason,'session_revoked');
    equal((await db.query(`SELECT count(*)::int AS n FROM user_devices WHERE user_id='${id(10)}' AND revoked_at IS NULL`)).rows[0].n,2);
    await denied(10,103,'SELECT * FROM revoked_device_sessions');
    // Recovery remains usable from an unregistered session when slots are full.
    const challenge = (await as(10,104,'SELECT begin_device_recovery() AS id'))[0].id;
    const list = await as(10,105,`SELECT * FROM list_account_devices('${challenge}')`,'otp');
    equal(list.length,2);
    equal((await as(10,105,`SELECT complete_device_recovery('${challenge}',ARRAY['${list[0].id}'::uuid],
      'recovered-web-installation','web','Recovered') AS result`,'otp'))[0].result.allowed,true);
    equal((await as(10,105,'SELECT current_session_has_device_access() AS allowed','otp'))[0].allowed,true);
    // Unpaid users can still read billing status and recover/leave; not vessel data.
    await db.exec(`UPDATE vessel_subscriptions SET status='revoked' WHERE vessel_id='${id(1)}'`);
    equal((await as(10,105,'SELECT id FROM vessels','otp')).length,0);
    equal((await as(10,105,`SELECT status FROM get_vessel_subscription_entitlement('${id(1)}')`,'otp'))[0].status,'revoked');
    equal((await as(10,105,'SELECT current_session_has_registered_device() AS allowed','otp'))[0].allowed,true);
    await db.exec(closeReads); await db.exec(strict); // safe reapplication
    equal((await register(101))[0].result.reason,'session_revoked');
    // Deleting an account must not fail when FK cascades remove its devices.
    await db.exec(`DELETE FROM auth.users WHERE id='${id(10)}'`);
    equal((await db.query(`SELECT count(*)::int AS n FROM user_devices WHERE user_id='${id(10)}'`)).rows[0].n,0);
    console.log(`${checks} web-security SQL assertions passed (anonymous disclosure, strict sessions, recovery and isolation).`);
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
