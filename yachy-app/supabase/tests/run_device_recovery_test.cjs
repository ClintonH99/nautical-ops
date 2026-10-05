// Disposable PostgreSQL; never connects to production or sends email.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let checks=0;const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(read('tests/minimal_foundation_schema.sql').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
  await db.exec(read('tests/local_auth_bootstrap.sql').replace(/^\\.*$/gm,''));
  for(const file of ['20260903151000_ENFORCE_TWO_DEVICE_LIMIT.sql','20261002130000_STRICT_SENSITIVE_ACTION_DEVICE_CHECK.sql','20261002140000_DEVICE_MANAGEMENT_AND_RECOVERY.sql'])await db.exec(read('migrations/'+file));
  await db.exec(`GRANT USAGE ON SCHEMA public,auth TO authenticated; INSERT INTO auth.users(id) VALUES ('${id(1)}'),('${id(2)}');`);
  const as=async(user,session,method,sql,age=0)=>{
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user?id(user):'',JSON.stringify({session_id:id(session),amr:[{method,timestamp:Math.floor(Date.now()/1000)-age}]})]);
   await db.exec('SET ROLE authenticated');try{return(await db.query(sql)).rows;}finally{await db.exec('RESET ROLE');}
  };
  const denied=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
  const list=(user,session,method,challenge)=>as(user,session,method,`SELECT * FROM list_account_devices(${challenge?`'${challenge}'`:'NULL'})`);
  for(const enabled of [false,true]){
   await db.exec(`TRUNCATE user_devices,device_recovery_challenges; UPDATE security_enforcement_settings SET enabled=${enabled};`);
   for(const session of [11,12])await as(1,session,'password',`SELECT register_user_device('recovery-test-browser-${session}','web','Test browser ${session}')`);
   await as(2,21,'password',"SELECT register_user_device('other-user-test-browser','web','Other browser')");
   const devices=await list(1,11,'password');equal(devices.length,2);equal(devices[0].is_current,true);
   equal(Object.keys(devices[0]).sort(),['device_name','id','is_current','last_seen_at','platform']);
   await denied(()=>as(1,13,'password','SELECT device_fingerprint FROM user_devices'),/permission denied/);
   await denied(()=>list(1,13,'password'),/Verify your account/);
   await denied(()=>as(1,13,'password',`SELECT remove_account_device('${devices[0].id}')`),/approved device/);
   await denied(()=>as(1,11,'password',`SELECT remove_account_device('${devices[0].id}')`),/Sign Out/);
   const other=(await list(2,21,'password'))[0];
   await denied(()=>as(1,11,'password',`SELECT remove_account_device('${other.id}')`),/no longer available/);
   await denied(()=>as(1,13,'otp','SELECT begin_device_recovery()'),/email and password/);
   await denied(()=>as(1,13,'password','SELECT begin_device_recovery()',600),/email and password/);
   const challenge=(await as(1,13,'password','SELECT begin_device_recovery() AS id'))[0].id;
   await denied(()=>list(1,13,'password',challenge),/Verify your account/);
   await denied(()=>list(2,21,'otp',challenge),/Verify your account/);
   equal((await list(1,14,'otp',challenge)).length,2);
   await denied(()=>as(1,14,'otp',`SELECT * FROM list_account_devices('${challenge}')`,1200),/Verify your account/);
   const complete=(ids,fingerprint='new-recovery-browser',session=14)=>as(1,session,'otp',
    `SELECT complete_device_recovery('${challenge}',ARRAY[${ids.map(x=>`'${x}'::UUID`).join(',')}]::UUID[],'${fingerprint}','web','New browser') AS result`);
   await denied(()=>complete([]),/Select at least one/);
   await denied(()=>complete([other.id]),/Device list changed/);
   await denied(()=>complete([devices[0].id,devices[0].id]),/Select at least one/);
   await denied(()=>complete([devices[0].id],'short'),/Invalid device fingerprint/);
   equal((await list(1,11,'password')).length,2); // rollback restored the old slot
   equal((await complete([devices[0].id]))[0].result.allowed,true);
   equal((await list(1,14,'otp')).length,2);
   await denied(()=>list(1,11,'password'),/Verify your account/);
   await denied(()=>list(1,14,'otp',challenge),/Verify your account/); // consumed grant
   equal((await complete([devices[0].id]))[0].result.allowed,true); // retry, no extra deletion
   await denied(()=>complete([devices[1].id],'another-recovery-browser',15),/expired/);
   await as(1,14,'otp',`SELECT remove_account_device('${devices[1].id}')`);
   equal((await list(1,14,'otp')).length,1);
   await denied(()=>list(1,12,'password'),/Verify your account/);
   equal((await as(1,16,'password',"SELECT register_user_device('second-new-test-browser','web','Second browser') AS r"))[0].r.allowed,true);
   equal((await as(1,17,'password',"SELECT register_user_device('third-new-test-browser','web','Third browser') AS r"))[0].r.allowed,false);
   const expired=(await as(1,18,'password','SELECT begin_device_recovery() AS id'))[0].id;
   await db.exec(`UPDATE device_recovery_challenges SET expires_at=now()-INTERVAL '1 second' WHERE id='${expired}'`);
   await denied(()=>list(1,19,'otp',expired),/Verify your account/);
   equal((await db.query('SELECT enabled FROM security_enforcement_settings')).rows[0].enabled,enabled);
  }
  for(const name of ['begin_device_recovery()','list_account_devices(uuid)','remove_account_device(uuid)','complete_device_recovery(uuid,uuid[],text,text,text)'])
   equal((await db.query(`SELECT has_function_privilege('anon','public.${name}','EXECUTE') AS allowed`)).rows[0].allowed,false);
  console.log(`${checks} device-management/recovery database assertions passed with rollout OFF and ON.`);
 }finally{await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
