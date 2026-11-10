import test from 'node:test';
import assert from 'node:assert/strict';
import { OfflineOutbox } from '../yachy-app/src/offline/outbox.ts';
import { crewLeaveAdapter } from '../yachy-app/src/offline/crewLeaveAdapter.ts';
import { selectOfflineLeavePage } from '../yachy-app/src/offline/crewLeaveQueries.ts';
import { MemoryStore, scope, permit, epoch } from './offline-fixtures.mjs';
const value={id:'leave-1',vessel_id:scope.vesselId,crew_member_id:scope.userId,leave_type:'ANNUAL',start_date:'2026-11-10',end_date:'2026-11-12',notes:'Before',created_by:scope.userId,created_at:'local',updated_at:'local',crew_member_name_snapshot:'Test',crew_member_position_snapshot:'Captain',crew_member_departments_snapshot:['BRIDGE']};
test('crew leave adapter enforces date ranges, fields, department snapshot and vessel ownership',()=>{
 assert.equal(crewLeaveAdapter.validate(value),true);
 for(const patch of [{end_date:'2026-11-01'},{start_date:'2026-02-31'},{notes:'x'.repeat(1001)},{leave_type:'UNKNOWN'},{crew_member_departments_snapshot:['BRIDGE','BRIDGE']},{extra:true}]) assert.equal(crewLeaveAdapter.validate({...value,...patch}),false);
 assert.equal(crewLeaveAdapter.authorizeRead(scope,{...value,vessel_id:'other'}),false);
 assert.equal(crewLeaveAdapter.authorize(scope,'create',{...value,created_by:'other'},null),false);
});
test('crew leave changes survive reopen and read-only grants block edits',async()=>{
 const store=new MemoryStore(),ctx={scope,permit:await permit({permissions:{crewLeave:['read','create','update']}}),nowMs:epoch,highestObservedMs:epoch,blocked:false};
 const box=()=>new OfflineOutbox({store,context:()=>ctx,adapters:{crewLeave:crewLeaveAdapter}});
 const save=(v,kind,version)=>box().save({feature:'crewLeave',recordId:value.id,kind,value:v,expectedLocalVersion:version});
 await save(value,'create',0);await save({...value,notes:'',leave_type:'ROTATION'},'update',1);
 assert.equal((await box().read('crewLeave',value.id)).value.notes,'');assert.equal((await store.read(scope)).changes.length,1);
 await assert.rejects(save(value,'update',1),(error) => error.code === 'LOCAL_CONFLICT');
 ctx.permit=await permit({permissions:{crewLeave:['read']}});await assert.rejects(save(value,'update',2),/ACTION_NOT_ALLOWED/);
});
test('offline leave paging applies status/type/department filters before slicing',()=>{
 const base={crewMemberDepartments:['BRIDGE'],leaveType:'ANNUAL'};
 const rows=[{...base,id:'past',startDate:'2026-10-01',endDate:'2026-10-10'},{...base,id:'current',startDate:'2026-11-01',endDate:'2026-11-11'},{...base,id:'future',startDate:'2026-11-12',endDate:'2026-11-20'},{...base,id:'interior',startDate:'2026-11-13',endDate:'2026-11-20',crewMemberDepartments:['INTERIOR'],leaveType:'OTHER'}];
 const filters={asOfDate:'2026-11-10',departments:['BRIDGE']};
 const first=selectOfflineLeavePage(rows,filters,0,1);assert.equal(first.items[0].id,'current');assert.equal(first.hasMore,true);
 assert.deepEqual(selectOfflineLeavePage(rows,filters,1,1).items.map(r=>r.id),['future']);
 assert.deepEqual(selectOfflineLeavePage(rows,{asOfDate:filters.asOfDate,status:'COMPLETED'},0,40).items.map(r=>r.id),['past']);
 assert.deepEqual(selectOfflineLeavePage(rows,{asOfDate:filters.asOfDate,status:'UPCOMING',leaveType:'OTHER'},0,40).items.map(r=>r.id),['interior']);
});
