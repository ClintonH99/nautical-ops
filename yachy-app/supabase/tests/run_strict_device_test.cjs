// Disposable PostgreSQL only. No production connection or account mutation.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let checks=0;
const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
(async()=>{
  const db=new PGlite();
  try {
    await db.exec(read('tests/minimal_foundation_schema.sql').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
    await db.exec(read('tests/local_auth_bootstrap.sql').replace(/^\\.*$/gm,''));
    await db.exec(read('migrations/20260903151000_ENFORCE_TWO_DEVICE_LIMIT.sql'));
    await db.exec(read('migrations/20261002130000_STRICT_SENSITIVE_ACTION_DEVICE_CHECK.sql'));
    await db.exec(`GRANT USAGE ON SCHEMA public,auth TO authenticated; INSERT INTO auth.users(id) VALUES ('${id(1)}'),('${id(2)}');`);
    const as=async(user,session,sql)=>{
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",[user?id(user):'',JSON.stringify(session?{session_id:id(session)}:{})]);
      await db.exec('SET ROLE authenticated');
      try{return (await db.query(sql)).rows[0];}finally{await db.exec('RESET ROLE');}
    };
    const approved=(user,session)=>as(user,session,'SELECT current_session_has_registered_device() AS approved');
    for (const enabled of [false,true]) {
      await db.exec(`TRUNCATE user_devices; UPDATE security_enforcement_settings SET enabled=${enabled};`);
      equal(await approved(1,11),{approved:false});
      for(const session of [11,12]) {
        equal((await as(1,session,`SELECT register_user_device('test-device-fingerprint-${session}','web','Browser') AS result`)).result.allowed,true);
        equal(await approved(1,session),{approved:true});
      }
      equal((await as(1,13,"SELECT register_user_device('test-device-fingerprint-13','web','Third') AS result")).result.allowed,false);
      equal(await approved(1,13),{approved:false});
      equal(await approved(2,11),{approved:false});
      equal(await approved(1,null),{approved:false});
      equal(await approved(null,11),{approved:false});
      await as(1,11,'SELECT revoke_current_device()');
      equal(await approved(1,11),{approved:false});
      equal(await approved(1,12),{approved:true});
      equal((await as(1,13,"SELECT register_user_device('test-device-fingerprint-13','web','Replacement') AS result")).result.allowed,true);
      equal(await approved(1,13),{approved:true});
      // A replacement login for the same browser invalidates its old session.
      await as(1,14,"SELECT register_user_device('test-device-fingerprint-13','web','Replacement')");
      equal(await approved(1,13),{approved:false});
      equal(await approved(1,14),{approved:true});
      equal((await db.query('SELECT enabled FROM security_enforcement_settings')).rows[0].enabled,enabled);
    }
    equal((await db.query("SELECT has_function_privilege('anon','public.current_session_has_registered_device()','EXECUTE') AS allowed")).rows[0].allowed,false);
    // No profile or subscription is required: unpaid/departing users remain eligible.
    equal((await db.query('SELECT count(*)::int AS total FROM users')).rows[0].total,0);
    equal((await db.query('SELECT count(*)::int AS total FROM vessel_subscriptions')).rows[0].total,0);
    await db.exec(read('migrations/20261002130000_STRICT_SENSITIVE_ACTION_DEVICE_CHECK.sql'));
    equal(await approved(1,14),{approved:true});
    console.log(`${checks} strict-device database assertions passed with rollout OFF and ON.`);
  }finally{await db.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
