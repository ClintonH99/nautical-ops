import test from 'node:test';
import assert from 'node:assert/strict';
import { tripsAdapter, tripDeviceCopy, validTripDate } from '../yachy-app/src/offline/tripsAdapter.ts';
import { OfflineOutbox } from '../yachy-app/src/offline/outbox.ts';
import { MemoryStore, scope, permit, epoch } from './offline-fixtures.mjs';
const value = {id:'trip-1',vessel_id:scope.vesselId,type:'GUEST',title:'Guest crossing',start_date:'2026-11-09',end_date:'2026-11-12',notes:'Trip notes',department:null,yard_location:null,contractor_company_name:null,contact_details:null,created_by:scope.userId,created_at:'2026-11-09T00:00:00Z',updated_at:'2026-11-09T00:00:00Z'};
test('trip date validation includes leap days, invalid dates and reversed ranges',()=>{
  assert.equal(validTripDate('2028-02-29'),true);
  assert.equal(validTripDate('2026-02-29'),false);
  assert.equal(validTripDate('2026-13-01'),false);
  assert.equal(tripsAdapter.validate(value),true);
  assert.equal(tripsAdapter.validate({...value,end_date:'2026-11-08'}),false);
  assert.equal(tripsAdapter.validate({...value,type:'UNKNOWN'}),false);
});
test('offline trip edits preserve identity and clearing notes survives reopening',async()=>{
 const store=new MemoryStore(); const context={scope,permit:await permit({permissions:{trips:['read','create','update']}}),nowMs:epoch,highestObservedMs:0,blocked:false};
 const box=new OfflineOutbox({store,context:()=>context,adapters:{trips:tripsAdapter}});
 await box.save({feature:'trips',recordId:value.id,kind:'create',value,expectedLocalVersion:0});
 await box.save({feature:'trips',recordId:value.id,kind:'update',value:{...value,notes:null,end_date:'2026-11-14'},expectedLocalVersion:1});
 const reopened=new OfflineOutbox({store,context:()=>context,adapters:{trips:tripsAdapter}});
 assert.equal((await reopened.read('trips',value.id)).value.notes,null);
 assert.equal((await store.read(scope)).changes.length,1);
 await assert.rejects(()=>box.save({feature:'trips',recordId:value.id,kind:'update',value,expectedLocalVersion:1}),(error) => error.code === 'LOCAL_CONFLICT');
 assert.equal(tripsAdapter.authorize(scope,'update',{...value,type:'BOSS'},{value}),false);
 assert.equal(tripsAdapter.authorizeRead(scope,{...value,vessel_id:'other'}),false);
 assert.equal(tripsAdapter.validate(tripDeviceCopy(value,'copy',scope.userId)),true);
});
