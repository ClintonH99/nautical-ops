import assert from 'node:assert/strict';
export async function runSeaChecks(t,{sql,run,user,vessel,device}){
 const call=op=>JSON.parse(run(`SELECT sync_web_offline_sea_miles('${vessel}','${device}','${JSON.stringify(op).replaceAll("'","''")}'::jsonb);`));
 const context=()=>JSON.parse(run(`SELECT read_web_offline_sea_context('${vessel}','${device}');`));
 const value={id:crypto.randomUUID(),user_id:user,status:'DRAFT',voyage_date:'2026-11-10',vessel_name:'Synthetic vessel',vessel_length:'45 ft',from_location:'A',to_location:'B',capacity_role:'Crew',miles_logged:12,day_hours:4,night_hours:1,tidal:false};
 const op={id:crypto.randomUUID(),recordId:value.id,feature:'seaMiles',kind:'create',value,baseRevision:null};
 const edit=(base,patch)=>({...op,id:crypto.randomUUID(),kind:'update',value:{...base.value,...patch},baseRevision:base.revision});
 let saved,pending;
 await t.test('sea miles: personal draft is stamped by original trigger and retries commit once',()=>{
  sql(`UPDATE users SET role='CREW' WHERE id='${user}';`);saved=call(op);assert.equal(saved.status,'applied');assert.deepEqual(call(op),saved);
  assert.equal(saved.value.status,'DRAFT');assert.notEqual(saved.value.owner_name,null);
  const forged={...op,id:crypto.randomUUID(),value:{...value,user_id:crypto.randomUUID()}};assert.equal(call(forged).status,'forbidden');
 });
 await t.test('sea miles: submission requires Captain, owners lock while pending, HOD cannot review',()=>{
  assert.equal(call(edit(saved,{status:'PENDING'})).status,'conflict');
  sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);pending=call(edit(saved,{status:'PENDING'}));assert.equal(pending.status,'applied');assert.equal(pending.value.review_vessel_id,vessel);
  sql(`UPDATE users SET role='HOD' WHERE id='${user}';`);assert.equal(call(edit(pending,{miles_logged:14})).status,'forbidden');assert.equal(call(edit(pending,{status:'APPROVED'})).status,'forbidden');
  sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);
 });
 await t.test('sea miles: changed signature/contact rejects stale approval; current approval snapshots and permanently locks',()=>{
  const before=context();sql(`UPDATE captain_sea_mile_contacts SET first_name='Changed' WHERE user_id='${user}';`);
  assert.equal(call(edit(pending,{status:'APPROVED',review_context_revision:before.reviewRevision})).status,'conflict');
  const approved=edit(pending,{status:'APPROVED',review_context_revision:context().reviewRevision});
  const result=call(approved);assert.equal(result.status,'applied');assert.equal(result.value.reviewer_contact_first_name,'Changed');assert.equal(result.value.reviewed_by,user);assert.equal(result.value.reviewer_signature_type,'typed');assert.deepEqual(call(approved),result);
  assert.equal(call(edit(result,{miles_logged:99})).status,'forbidden');
 });
 await t.test('sea miles: create-and-submit is atomic, decline reason required, personal history remains readable after correction',()=>{
  const row=crypto.randomUUID(),create={...op,id:crypto.randomUUID(),recordId:row,value:{...value,id:row,status:'PENDING'}};
  const p=call(create);assert.equal(p.status,'applied');assert.deepEqual(call(create),p);
  const decline={...create,id:crypto.randomUUID(),kind:'update',value:{...p.value,status:'DECLINED',decline_comment:''},baseRevision:p.revision};assert.equal(call(decline).status,'conflict');
  decline.value.decline_comment='Check hours';const d=call(decline);assert.equal(d.status,'applied');
  const corrected={...decline,id:crypto.randomUUID(),value:{...d.value,status:'DRAFT',day_hours:5},baseRevision:d.revision};assert.equal(call(corrected).status,'applied');
  const records=JSON.parse(run(`SELECT read_web_offline_sea_miles('${vessel}','${device}');`));assert.equal(records.length,2);assert.ok(records.every(r=>r.value.user_id===user));
 });
 await t.test('sea miles: Captain reviews other crew through RLS; role loss blocks replay; historical review vessel does not hide own record',()=>{
  const other='00000000-0000-0000-0000-000000000009', id=crypto.randomUUID();
  sql(`SET request.jwt.claim.sub='${other}'; INSERT INTO sea_mile_entries(id,user_id,owner_name,voyage_date,vessel_name,vessel_length,from_location,to_location,capacity_role,miles_logged,day_hours,night_hours) VALUES('${id}','${other}','ignored','2026-11-10','Other crew voyage','40 ft','A','B','Crew',10,2,1); UPDATE sea_mile_entries SET status='PENDING' WHERE id='${id}';`);
  const rows=JSON.parse(run(`SELECT read_web_offline_sea_miles_review('${vessel}','${device}');`));
  const original=rows.find(r=>r.value.id===id);assert.ok(original);
  const review={id:crypto.randomUUID(),recordId:id,feature:'seaMilesReview',kind:'update',baseRevision:original.revision,value:{...original.value,status:'APPROVED',review_context_revision:context().reviewRevision}};
  const approved=call(review);assert.equal(approved.status,'applied');assert.equal(approved.value.user_id,other);
  sql(`UPDATE users SET role='HOD' WHERE id='${user}';`);assert.equal(call(review).status,'forbidden');
  sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);assert.deepEqual(call(review),approved);
  // Only fixture setup bypasses the trigger, to represent a historical vessel association.
  sql(`ALTER TABLE sea_mile_entries DISABLE TRIGGER USER; UPDATE sea_mile_entries SET review_vessel_id=NULL WHERE user_id='${user}' AND status='APPROVED'; ALTER TABLE sea_mile_entries ENABLE TRIGGER USER;`);
  const own=JSON.parse(run(`SELECT read_web_offline_sea_miles('${vessel}','${device}');`));assert.equal(own.length,2);assert.ok(own.some(r=>r.value.status==='APPROVED'&&r.value.review_vessel_id===null));
 });

}
