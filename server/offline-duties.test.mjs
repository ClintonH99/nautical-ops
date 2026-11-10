import test from 'node:test';
import assert from 'node:assert/strict';
import { watchDutiesAdapter } from '../yachy-app/src/offline/watchDutiesAdapter.ts';
import { OfflineOutbox } from '../yachy-app/src/offline/outbox.ts';
import { MemoryStore,scope,permit,epoch,transport,success } from './offline-fixtures.mjs';
const group={id:'group',vessel_id:scope.vesselId,title:'Engine watch',department:'ENGINEERING',created_at:'local',items:[{id:'item',group_id:'group',label:'Check bilges',sort_order:0,created_at:'local'}]};
const check={id:'item',item_id:'item',vessel_id:scope.vesselId,user_id:scope.userId,checked:true,updated_at:'local'};
async function fixture(manager=true){
 const store=new MemoryStore(),ctx={scope,permit:await permit({permissions:{watchDuties:manager?['read','create','update']:['read'],watchDutyChecks:['read','create','update']}}),nowMs:epoch,highestObservedMs:epoch,blocked:false};
 const adapters={watchDuties:watchDutiesAdapter('watchDuties'),watchDutyChecks:watchDutiesAdapter('watchDutyChecks')};
 const box=new OfflineOutbox({store,context:()=>ctx,adapters});
 await box.replaceSnapshot('watchDuties',[]);await box.replaceSnapshot('watchDutyChecks',[]);
 return {store,ctx,box,adapters,save:(feature,value,kind,version)=>box.save({feature,value,recordId:value.id,kind,expectedLocalVersion:version})};
}
test('duties validate item ownership and unique IDs, singleton keys, clock values',()=>{
 const a=watchDutiesAdapter('watchDuties');assert.ok(a.validate(group));
 for(const items of [[{...group.items[0],group_id:'foreign'}],[...group.items,...group.items],[{...group.items[0],secret:true}]])assert.equal(a.validate({...group,items}),false);
 assert.ok(watchDutiesAdapter('watchDutyChecks').validate(check));
 assert.equal(watchDutiesAdapter('watchDutyChecks').authorizeRead(scope,{...check,user_id:'other'}),false);
 assert.equal(watchDutiesAdapter('watchDutyRules').validate({id:'other',vessel_id:scope.vesselId,content:'rules',updated_at:'now'}),false);
 const assignment={id:'assignment',vessel_id:scope.vesselId,user_id:scope.userId,date:'2026-11-10',start_time:'18:00',end_time:'08:00',created_at:'local'};
 assert.ok(watchDutiesAdapter('watchAssignments').validate(assignment));
 assert.equal(watchDutiesAdapter('watchAssignments').validate({...assignment,date:'2026-02-31'}),false);
 assert.equal(watchDutiesAdapter('watchAssignments').validate({...assignment,end_time:'25:00'}),false);
});
test('duty lists and personal checkmarks survive reload and upload parent before child',async()=>{
 const {box,store,ctx,adapters,save}=await fixture();
 await save('watchDuties',group,'create',0);await save('watchDutyChecks',check,'create',0);
 const reopened=new OfflineOutbox({store,context:()=>ctx,adapters});
 assert.equal((await reopened.list('watchDutyChecks'))[0].value.checked,true);
 const sent=[];await reopened.sync(transport(async(_s,op)=>{sent.push(op.feature);return success(op);}));
 assert.deepEqual(sent,['watchDuties','watchDutyChecks']);assert.equal((await store.read(scope)).changes.length,0);
});
test('lost reply keeps attempted group immutable and appends later children without duplicating server timestamps',async()=>{
 const {box,store,save}=await fixture();await save('watchDuties',group,'create',0);
 let first;await box.sync(transport(async(_s,op)=>{first=op;throw Error('reply lost');}));
 const added={id:'item-2',group_id:group.id,label:'Check pumps',sort_order:1,created_at:'local'};
 await save('watchDuties',{...group,items:[...group.items,added]},'update',1);
 const sent=[];await box.sync(transport(async(_s,op)=>{sent.push(op);return {...success(op),value:{...op.value,created_at:'server',items:op.value.items.map(i=>({...i,created_at:'server'}))}};}));
 assert.deepEqual(sent[0],first);assert.equal(sent.length,2);assert.equal(sent[1].value.items[0].created_at,'server');
 assert.equal((await box.list('watchDuties'))[0].value.items.length,2);assert.equal((await store.read(scope)).changes.length,0);
});
test('crew can check only own items and cannot edit shared duties; stale tab cannot replace a newer check',async()=>{
 const {box,save}=await fixture(false);
 await assert.rejects(save('watchDuties',group,'create',0),/ACTION_NOT_ALLOWED/);
 await assert.rejects(save('watchDutyChecks',{...check,user_id:'other'},'create',0),/ACTION_NOT_ALLOWED/);
 await save('watchDutyChecks',check,'create',0);await save('watchDutyChecks',{...check,checked:false},'update',1);
 await assert.rejects(save('watchDutyChecks',check,'update',1),(error) => error.code === 'LOCAL_CONFLICT');
 assert.equal((await box.list('watchDutyChecks'))[0].value.checked,false);
});
