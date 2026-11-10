import test from 'node:test';
import assert from 'node:assert/strict';
import { seaMilesAdapter,seaServerFields } from '../yachy-app/src/offline/seaMilesAdapter.ts';
import { OfflineOutbox } from '../yachy-app/src/offline/outbox.ts';
import { MemoryStore,scope,permit,epoch,transport,success } from './offline-fixtures.mjs';
const row={...Object.fromEntries(seaServerFields.map(k=>[k,null])),id:'sea-1',user_id:scope.userId,owner_name:'Synthetic crew',created_at:'local',updated_at:'local',status:'DRAFT',voyage_date:'2026-11-10',vessel_name:'Test vessel',vessel_length:'45 ft',from_location:'A',to_location:'B',capacity_role:'Deckhand',miles_logged:12,day_hours:4,night_hours:1,tidal:false,decline_comment:null,review_context_revision:null};
const permissions=captain=>({seaMiles:['read','create','update'],...(captain?{seaMilesReview:['read','update']}:{})});
async function fixture(captain=false,initial=[]){
 const store=new MemoryStore(),ctx={scope,permit:await permit({permissions:permissions(captain)}),nowMs:epoch,highestObservedMs:epoch,blocked:false};
 const adapters={seaMiles:seaMilesAdapter(),seaMilesReview:seaMilesAdapter(true)};
 const box=new OfflineOutbox({store,context:()=>ctx,adapters});
 await box.replaceSnapshot('seaMiles',initial.map(value=>({recordId:value.id,value,revision:'original'})));
 return {store,ctx,box,adapters,save:(value,kind,version,feature='seaMiles')=>box.save({feature,value,recordId:value.id,kind,expectedLocalVersion:version})};
}
test('sea miles rejects foreign ownership, invalid dates, amounts and approval-only creation',async()=>{
 const a=seaMilesAdapter();assert.ok(a.validate(row));
 for(const patch of [{voyage_date:'2026-02-31'},{miles_logged:-1},{extra:true},{status:'DECLINED',decline_comment:' '}])assert.equal(a.validate({...row,...patch}),false);
 const {save}=await fixture();
 await assert.rejects(save({...row,user_id:'other'},'create',0),/ACTION_NOT_ALLOWED/);
 await assert.rejects(save({...row,status:'APPROVED'},'create',0),/ACTION_NOT_ALLOWED/);
});
test('offline draft edits and submission survive reopening, then lock for the owner',async()=>{
 const {save,box,store,ctx,adapters}=await fixture();
 await save(row,'create',0);
 const edited={...row,miles_logged:22};await save(edited,'update',1);
 const pending={...edited,status:'PENDING',review_vessel_id:scope.vesselId};await save(pending,'update',2);
 await assert.rejects(save({...pending,miles_logged:44},'update',3),/ACTION_NOT_ALLOWED/);
 const reopened=new OfflineOutbox({store,context:()=>ctx,adapters});assert.equal((await reopened.list('seaMiles'))[0].value.miles_logged,22);
 const sent=[];await reopened.sync(transport(async(_,op)=>{sent.push(op);return success(op);}));
 assert.equal(sent.length,1);assert.equal(sent[0].kind,'create');assert.equal(sent[0].value.status,'PENDING');assert.equal((await store.read(scope)).changes.length,0);
});
test('offline approval stays immutable locally while its exact queued intent retries after a lost reply',async()=>{
 const pending={...row,status:'PENDING',review_vessel_id:scope.vesselId};
 const {save,box,store,ctx,adapters}=await fixture(true,[pending]);
 const current=(await box.list('seaMiles'))[0];await save({...pending,status:'APPROVED',review_context_revision:'contact-and-signature'},'update',current.localVersion);
 const approved=(await box.list('seaMiles'))[0];await assert.rejects(save({...approved.value,miles_logged:99},'update',approved.localVersion),/ACTION_NOT_ALLOWED/);
 let attempted;await box.sync(transport(async(_,op)=>{attempted=op;throw Error('lost reply');}));assert.ok(attempted);
 const reopened=new OfflineOutbox({store,context:()=>ctx,adapters});
 await reopened.sync(transport(async(_,op)=>{assert.deepEqual(op,attempted);return {...success(op),value:{...op.value,reviewed_by:scope.userId,reviewed_at:'server',reviewer_typed_name:'Verified Captain'}};}));
 assert.equal((await store.read(scope)).changes.length,0);assert.equal((await reopened.list('seaMiles'))[0].value.reviewed_at,'server');
});
test('changed Captain permission prevents queued approval from reaching the transport and preserves pending work',async()=>{
 const pending={...row,status:'PENDING',review_vessel_id:scope.vesselId};const {save,box,ctx,store}=await fixture(true,[pending]);
 await save({...pending,status:'APPROVED'},'update',(await box.list('seaMiles'))[0].localVersion);
 ctx.permit=await permit({permissions:permissions(false)});
 let requests=0;await box.sync(transport(async(_,op)=>{requests++;return success(op);}));
 assert.equal(requests,0);assert.equal((await store.read(scope)).changes.length,1);
});
test('Captain review cache excludes own rows and other vessels',async()=>{
 const {box}=await fixture(true);
 await assert.rejects(box.replaceSnapshot('seaMilesReview',[{recordId:row.id,value:row,revision:'r'}]),/INVALID_RECORD/);
 await assert.rejects(box.replaceSnapshot('seaMilesReview',[{recordId:row.id,value:{...row,user_id:'other',review_vessel_id:'foreign'},revision:'r'}]),/INVALID_RECORD/);
 await box.replaceSnapshot('seaMilesReview',[{recordId:row.id,value:{...row,user_id:'other',review_vessel_id:scope.vesselId,status:'PENDING'},revision:'r'}]);
 assert.equal((await box.list('seaMilesReview')).length,1);
});
