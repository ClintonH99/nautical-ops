import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationsAdapter, publicationDeviceCopy } from '../yachy-app/src/offline/publicationsAdapter.ts';
import { OfflineOutbox } from '../yachy-app/src/offline/outbox.ts';
import { MemoryStore, scope, permit, epoch } from './offline-fixtures.mjs';
for (const feature of ['rules','safetyEquipment','musterStations']) {
  test(feature+': durable nested edits, stale forms and read-only grants', async () => {
    const store = new MemoryStore();
    const context = { scope, permit: await permit({permissions:{[feature]:['read','create','update']}}), nowMs:epoch, highestObservedMs:0, blocked:false };
    const box = new OfflineOutbox({store,context:()=>context,adapters:{[feature]:publicationsAdapter}});
    const value = {id:'plan-1',vessel_id:scope.vesselId,title:'Vessel plan',data:{locations:['Deck']},created_by:scope.userId,created_at:'2026-11-09T00:00:00Z'};
    await box.save({feature,recordId:value.id,kind:'create',value,expectedLocalVersion:0});
    await box.save({feature,recordId:value.id,kind:'update',value:{...value,data:{locations:['Bridge','Deck']}},expectedLocalVersion:1});
    assert.equal((await store.read(scope)).changes.length,1);
    const reopened = new OfflineOutbox({store,context:()=>context,adapters:{[feature]:publicationsAdapter}});
    assert.deepEqual((await reopened.read(feature,value.id)).value.data.locations,['Bridge','Deck']);
    await assert.rejects(()=>box.save({feature,recordId:value.id,kind:'update',value,expectedLocalVersion:1}), /LOCAL_CONFLICT/);
    context.permit = await permit({permissions:{[feature]:['read']}});
    await assert.rejects(()=>box.save({feature,recordId:value.id,kind:'update',value,expectedLocalVersion:2}));
    assert.deepEqual((await reopened.read(feature,value.id)).value.data.locations,['Bridge','Deck']);
    assert.equal(publicationsAdapter.authorize(scope,'update',{...value,created_by:'other'},{value}),false);
    assert.equal(publicationsAdapter.authorizeRead(scope,{...value,vessel_id:'other'}),false);
    const copy = publicationDeviceCopy(value,'copy',scope.userId);
    assert.equal(publicationsAdapter.validate(copy),true);
    assert.deepEqual(copy.data,value.data);
  });
}
