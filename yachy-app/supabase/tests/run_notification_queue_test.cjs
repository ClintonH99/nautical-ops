// Disposable in-memory PostgreSQL. Never connects to the live project.
const fs=require('node:fs'); const path=require('node:path'); const assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const read=file=>fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
(async()=>{
 const db=new PGlite();let checks=0;
 const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
 const count=async()=>Number((await db.query('SELECT count(*) n FROM notification_deliveries')).rows[0].n);
 const recipients=async()=> (await db.query('SELECT DISTINCT recipient_id FROM notification_deliveries ORDER BY recipient_id')).rows.map(r=>r.recipient_id);
 try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
   CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL AS $$ SELECT nullif(current_setting('test.user',true),'')::UUID $$;
   CREATE TABLE vessels(id UUID PRIMARY KEY);
   CREATE TABLE users(id UUID PRIMARY KEY,vessel_id UUID,department TEXT,department_2 TEXT,push_token TEXT,notification_preferences JSONB,name TEXT DEFAULT 'Test crew',role TEXT DEFAULT 'CREW');
   CREATE TABLE user_devices(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID,device_fingerprint TEXT,expo_push_token TEXT,revoked_at TIMESTAMPTZ,push_token_updated_at TIMESTAMPTZ,last_seen_at TIMESTAMPTZ);
   CREATE TABLE crew_leave(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),vessel_id UUID,crew_member_id UUID,leave_type TEXT,start_date DATE,end_date DATE,updated_at TIMESTAMPTZ);
   CREATE TABLE trips(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),vessel_id UUID,title TEXT,type TEXT,start_date DATE,end_date DATE,updated_at TIMESTAMPTZ);
   CREATE TABLE pre_departure_checklists(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),vessel_id UUID,title TEXT,trip_id UUID,updated_at TIMESTAMPTZ);`);
  const baseline=read('supabase/migrations/20260213000000_PRODUCTION_SCHEMA_BASELINE.sql');
  for(const table of ['vessel_tasks','maintenance_logs','yard_period_jobs','watch_keeping_timetables']){
   const definition=baseline.match(new RegExp('CREATE TABLE IF NOT EXISTS "public"\\."'+table+'" \\([\\s\\S]*?\\n\\);'));assert.ok(definition);await db.exec(definition[0]);
  }
  await db.exec(read('supabase/migrations/20261001120000_RELIABLE_NOTIFICATION_QUEUE.sql'));
  await db.exec(`CREATE FUNCTION public.current_session_has_device_access() RETURNS BOOLEAN LANGUAGE SQL AS $$ SELECT COALESCE(current_setting('test.device',true),'yes') <> 'no' $$;
   CREATE FUNCTION public.vessel_subscription_allows_access(UUID) RETURNS BOOLEAN LANGUAGE SQL AS $$ SELECT COALESCE(current_setting('test.subscription',true),'yes') <> 'no' $$;
   GRANT USAGE ON SCHEMA auth,public TO authenticated;`);
  const security=read('supabase/migrations/20260903152000_SERVER_SIDE_ACCESS_ENFORCEMENT.sql');
  for(const fn of ['current_user_can_access_vessel','current_user_can_manage_vessel']){
   const definition=security.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+fn+'\\([\\s\\S]*?\\$\\$;'));assert.ok(definition);await db.exec(definition[0]);
  }
  await db.exec(`INSERT INTO vessels VALUES('${id(1)}'),('${id(2)}');
   INSERT INTO users(id,vessel_id,department,department_2) VALUES
   ('${id(10)}','${id(1)}','BRIDGE',NULL),('${id(11)}','${id(1)}','EXTERIOR','BRIDGE'),
   ('${id(12)}','${id(1)}','INTERIOR',NULL),('${id(13)}','${id(2)}','BRIDGE',NULL);
   INSERT INTO user_devices(user_id,device_fingerprint,expo_push_token)
     SELECT id,'installation-123456','ExpoPushToken['||id||']' FROM users;
   SELECT set_config('test.user','${id(10)}',false);`);
  const task=async(title='Task')=> db.query("INSERT INTO vessel_tasks(vessel_id,category,department,title) VALUES($1,'DAILY','BRIDGE',$2) RETURNING id",[id(1),title]);
  await task('Before activation');check(await count(),0);
  await db.exec('UPDATE notification_runtime SET enabled=true');
  const t=(await task()).rows[0].id;
  check(await recipients(),[id(10),id(11)]); // primary + secondary department, never another vessel
  await db.query('UPDATE vessel_tasks SET updated_at=now() WHERE id=$1',[t]);check(await count(),2);
  await db.exec('DELETE FROM notification_deliveries');
  await db.exec(`INSERT INTO crew_leave(vessel_id,crew_member_id,leave_type,start_date,end_date) VALUES('${id(1)}','${id(12)}','ANNUAL','2026-10-01','2026-10-05')`);
  check(await recipients(),[id(12)]);
  await db.exec('DELETE FROM notification_deliveries');
  await db.query("INSERT INTO watch_keeping_timetables(vessel_id,watch_title,start_time,slots) VALUES($1,'Watch','08:00',$2)",[id(1),JSON.stringify([{crewId:id(11)},{crewId:id(11)},{crewId:id(13)}])]);
  check(await recipients(),[id(11)]);
  await db.exec('DELETE FROM notification_deliveries');
  const maint=()=>db.query("INSERT INTO maintenance_logs(vessel_id,equipment,service_done_by) VALUES($1,'Generator','Captain')",[id(1)]);
  await maint();check(await count(),0);
  await db.query('INSERT INTO maintenance_notification_settings(vessel_id,recipient_ids) VALUES($1,$2)',[id(1),[id(10),id(11)]]);
  await maint();check(await recipients(),[id(10),id(11)]);
  await db.query('UPDATE users SET vessel_id=$1 WHERE id=$2',[id(2),id(11)]);
  check((await db.query('SELECT recipient_ids FROM maintenance_notification_settings')).rows[0].recipient_ids,[id(10)]);
  const claimed=(await db.query('SELECT * FROM claim_notification_deliveries(false)')).rows;
  check(claimed.map(r=>r.recipient_id),[id(10)]);
  check((await db.query('SELECT * FROM claim_notification_deliveries(false)')).rows.length,0); // lease excludes concurrent worker
  await db.exec('DELETE FROM notification_deliveries');
  // Explicit opt-out survives refresh; opt-in is an explicit separate RPC.
  await db.query("SELECT clear_current_device_push_token('installation-123456')");
  check((await db.query("SELECT set_current_device_push_token('installation-123456','ExpoPushToken[new]') allowed")).rows[0].allowed,false);
  check((await db.query('SELECT push_token FROM users WHERE id=$1',[id(10)])).rows[0].push_token,null);
  await maint();check(await count(),0);
  await db.query("SELECT enable_current_device_push('installation-123456','ExpoPushToken[new]')");
  await maint();check(await count(),1);
  await db.query("UPDATE users SET notification_preferences='{"+'"maintenance":false'+"}' WHERE id=$1",[id(10)]);
  check((await db.query('SELECT * FROM claim_notification_deliveries(false)')).rows.length,0);
  await db.exec('DELETE FROM notification_deliveries');
  await db.query("INSERT INTO trips(vessel_id,title,start_date) VALUES($1,'Tomorrow',(now() AT TIME ZONE 'UTC')::DATE+1)",[id(1)]);
  await db.exec('DELETE FROM notification_deliveries');
  await db.exec('SELECT enqueue_trip_notification_reminders(); SELECT enqueue_trip_notification_reminders();');check(await count(),2);
  await db.exec('DELETE FROM notification_deliveries');
  await db.exec('BEGIN'); await task('Rolled back');await db.exec('ROLLBACK');check(await count(),0);
  // Client roles cannot forge pushes or read other people's queued content.
  for(const sql of ['SELECT * FROM notification_deliveries','SELECT * FROM claim_notification_deliveries(false)',"SELECT enqueue_notification('trips','{}','created','fake')"]){
   await db.exec('SET ROLE authenticated');await assert.rejects(db.query(sql),/permission denied/);checks++;await db.exec('RESET ROLE');
  }
  // No delete notification, and deleted sources cannot deliver stale queued content.
  await db.query('UPDATE users SET notification_preferences=NULL WHERE id=$1',[id(10)]);
  const deleted=(await task('Delete me')).rows[0].id;const before=await count();
  await db.query('DELETE FROM vessel_tasks WHERE id=$1',[deleted]);check(await count(),before);
  check((await db.query('SELECT * FROM claim_notification_deliveries(false)')).rows.length,0);
  // Exercise the actual management RPCs as authenticated users, not table-owner
  // writes: Captain and HOD allowed; Crew, other vessels and blocked sessions denied.
  await db.exec(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${id(10)}';
    UPDATE users SET role='HOD',vessel_id='${id(1)}' WHERE id='${id(11)}';
    UPDATE users SET role='CAPTAIN_MOV' WHERE id='${id(13)}';`);
  const asUser=async(user,fn)=>{
   await db.query("SELECT set_config('test.user',$1,false)",[id(user)]);await db.exec('SET ROLE authenticated');
   try{return await fn();}finally{await db.exec('RESET ROLE');}
  };
  const get=async(vessel=id(1))=>(await db.query('SELECT get_maintenance_notification_recipients($1) s',[vessel])).rows[0].s;
  const save=async(ids,revision)=>(await db.query('SELECT set_maintenance_notification_recipients($1,$2,$3) s',[id(1),ids,revision])).rows[0].s;
  const captain=await asUser(10,()=>get());check(captain.crew.map(p=>p.id).sort(),[id(10),id(11),id(12)]);
  check(Object.keys(captain.crew[0]).sort(),['id','name']);
  const saved=await asUser(10,()=>save([id(10),id(12)],captain.revision));check(saved.recipientIds,[id(10),id(12)]);
  const hod=await asUser(11,()=>get());const cleared=await asUser(11,()=>save([],hod.revision));check(cleared.recipientIds,[]);
  await assert.rejects(asUser(10,()=>save([id(10)],hod.revision)),/Recipients changed/);checks++;
  await assert.rejects(asUser(10,()=>save([id(13)],cleared.revision)),/Crew list changed/);checks++;
  await assert.rejects(asUser(12,()=>get()),/Only Captain MOV and HOD/);checks++;
  await assert.rejects(asUser(12,()=>save([id(12)],cleared.revision)),/Only Captain MOV and HOD/);checks++;
  await assert.rejects(asUser(13,()=>get()),/Only Captain MOV and HOD/);checks++;
  await assert.rejects(asUser(13,()=>save([id(10)],cleared.revision)),/Only Captain MOV and HOD/);checks++;
  for(const flag of ['device','subscription']){
   await db.query("SELECT set_config($1,'no',false)",['test.'+flag]);
   await assert.rejects(asUser(10,()=>save([id(10)],cleared.revision)),/Only Captain MOV and HOD/);checks++;
   await db.query("SELECT set_config($1,'yes',false)",['test.'+flag]);
  }
  await asUser(10,()=>save([id(10),id(11)],cleared.revision));
  await db.query('UPDATE users SET vessel_id=NULL WHERE id=$1',[id(11)]);
  check((await asUser(10,()=>get())).recipientIds,[id(10)]);
  await db.query('DELETE FROM users WHERE id=$1',[id(10)]);
  check((await db.query('SELECT recipient_ids FROM maintenance_notification_settings')).rows[0].recipient_ids,[]);
  console.log(`Notification queue PostgreSQL checks passed: ${checks}`);
 } finally {await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
