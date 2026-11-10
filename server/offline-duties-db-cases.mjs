import assert from 'node:assert/strict';
export async function runDutiesChecks(t,{sql,run,user,vessel,device}){
 const rpc={watchDuties:'watch_duties',watchDutyChecks:'watch_duty_checks',watchDutyRules:'watch_duty_rules',watchAssignments:'watch_assignments'};
 const call=op=>JSON.parse(run(`SELECT sync_web_offline_${rpc[op.feature]}('${vessel}','${device}','${JSON.stringify(op).replaceAll("'","''")}'::jsonb);`));
 const make=(feature,value)=>({id:crypto.randomUUID(),recordId:value.id,feature,kind:'create',value,baseRevision:null});
 const edit=(op,saved,patch)=>({...op,id:crypto.randomUUID(),kind:'update',value:{...saved.value,...patch},baseRevision:saved.revision});
 const id=crypto.randomUUID(),itemId=crypto.randomUUID();
 const group=make('watchDuties',{id,vessel_id:vessel,title:'Engine watch',department:'ENGINEERING',created_at:'local',items:[{id:itemId,group_id:id,label:'Inspect bilges',sort_order:0,created_at:'local'}]});
 let saved;
 await t.test('duties: manager group and all items commit once; crew cannot create',()=>{
  sql(`UPDATE users SET role='CREW' WHERE id='${user}';`);
  assert.equal(call(group).status,'forbidden');
  sql(`UPDATE users SET role='HOD' WHERE id='${user}';`);
  saved=call(group);assert.equal(saved.status,'applied');assert.deepEqual(call(group),saved);
  assert.equal(sql(`SELECT count(*) FROM watch_duty_items WHERE group_id='${id}';`),'1');
 });
 await t.test('duties: child conflict rolls back parent and receipt; stale edits cannot overwrite',()=>{
  const otherId=crypto.randomUUID(),op=make('watchDuties',{...group.value,id:otherId,items:[{...group.value.items[0],group_id:otherId}]});
  assert.equal(call(op).status,'conflict');assert.equal(sql(`SELECT count(*) FROM watch_duty_groups WHERE id='${otherId}';`),'0');
  const old=saved;saved=call(edit(group,saved,{title:'Updated engine watch'}));assert.equal(saved.status,'applied');
  assert.equal(call(edit(group,old,{title:'Stale title'})).status,'conflict');
  assert.equal(call(edit(group,saved,{items:[]})).status,'forbidden');
 });
 await t.test('duties: own checkmarks only, isolated from shared revision and server reset',()=>{
  sql(`UPDATE users SET role='CREW' WHERE id='${user}';`);
  const op=make('watchDutyChecks',{id:itemId,vessel_id:vessel,item_id:itemId,user_id:user,checked:true,updated_at:'local'});
  const checked=call(op);assert.equal(checked.status,'applied');assert.deepEqual(call(op),checked);
  const groups=JSON.parse(run(`SELECT read_web_offline_watch_duties('${vessel}','${device}');`));
  assert.equal(groups.find(g=>g.value.id===id).revision,saved.revision);
  assert.throws(()=>call({...op,id:crypto.randomUUID(),value:{...op.value,user_id:crypto.randomUUID()}}),/Invalid personal checkmark/);
  const unchecked=call(edit(op,checked,{checked:false}));assert.equal(unchecked.status,'applied');
  assert.equal(call(edit(op,checked,{checked:true})).status,'conflict');
  sql(`DELETE FROM watch_duty_completions WHERE item_id='${itemId}';`);
  assert.equal(call(edit(op,unchecked,{checked:true})).status,'forbidden');
 });
 await t.test('duties: singleton rules conflict, assignment overnight times and current crew permissions',()=>{
  const rules=make('watchDutyRules',{id:vessel,vessel_id:vessel,content:'Call the captain',updated_at:'local'});
  assert.equal(call(rules).status,'forbidden');sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);
  assert.equal(call(rules).status,'applied');assert.equal(call({...rules,id:crypto.randomUUID()}).status,'conflict');
  const assignment=make('watchAssignments',{id:crypto.randomUUID(),vessel_id:vessel,user_id:user,date:'2026-11-10',start_time:'18:00',end_time:'08:00',created_at:'local'});
  const a=call(assignment);assert.equal(a.status,'applied');assert.deepEqual(call(assignment),a);
  assert.equal(call({...assignment,id:crypto.randomUUID(),value:{...assignment.value,user_id:crypto.randomUUID()}}).status,'forbidden');
  assert.throws(()=>call({...assignment,id:crypto.randomUUID(),value:{...assignment.value,start_time:'25:00'}}),/Invalid watch date/);
  sql(`UPDATE users SET role='CREW' WHERE id='${user}';`);
  assert.equal(call(edit(assignment,a,{start_time:'19:00'})).status,'forbidden');
  sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}';`);
 });
}
