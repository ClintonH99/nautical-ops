/** @jest-environment node */
import { checkReceipts, Delivery, notificationMessage, sendDeliveries } from '../../supabase/functions/process-notifications/delivery';
const row: Delivery = { id: 'delivery', lease_id:'lease', recipient_id:'crew', vessel_id:'vessel', token:'ExpoPushToken[test]', source_table:'crew_leave', source_id:'leave', event:'created', payload:{ leave_type:'ANNUAL',start_date:'2026-10-01',end_date:'2026-10-05' }, attempts:1,ticket_id:null };
const store = () => ({ finish:jest.fn(async () => {}),invalidate:jest.fn(async () => {}) });
const response = (data: unknown, status = 200) => jest.fn(async () => new Response(JSON.stringify({data}), {status})) as unknown as typeof fetch;
describe('durable push delivery', () => {
  it('records accepted tickets for receipt checking after 15 minutes', async () => {
    const db = store();
    await sendDeliveries([row],db,response([{status:'ok',id:'ticket'}]),{},0);
    expect(db.finish).toHaveBeenCalledWith(row,expect.objectContaining({status:'accepted',ticket_id:'ticket',available_at:'1970-01-01T00:15:00.000Z'}));
  });
  it.each([429,500,503])('retries temporary HTTP %s failures',async status => {
    const db=store(); await sendDeliveries([row],db,response(null,status),{},0);
    expect(db.finish).toHaveBeenCalledWith(row,expect.objectContaining({status:'pending'}));
  });
  it('does not endlessly retry invalid requests',async () => {
    const db=store(); await sendDeliveries([row],db,response(null,400),{},0);
    expect(db.finish).toHaveBeenCalledWith(row,expect.objectContaining({status:'failed'}));
  });
  it('bounds temporary retries to five attempts',async () => {
    const db=store(); await sendDeliveries([{...row,attempts:5}],db,response(null,503),{},0);
    expect(db.finish).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({status:'failed'}));
  });
  it('preserves successes when another ticket fails',async () => {
    const db=store(); await sendDeliveries([row,{...row,id:'second'}],db,response([{status:'ok',id:'a'},{status:'error',details:{error:'MessageRateExceeded'}}]),{},0);
    expect(db.finish.mock.calls.map((args:any[]) => args[1].status)).toEqual(['accepted','pending']);
  });
  it('clears unregistered tokens from both ticket and receipt errors',async () => {
    const db=store(); const error={status:'error',details:{error:'DeviceNotRegistered'}};
    await sendDeliveries([row],db,response([error]),{},0);
    await checkReceipts([{...row,ticket_id:'ticket'}],db,response({ticket:error}),{},0);
    expect(db.invalidate).toHaveBeenCalledTimes(2);
    expect(db.finish.mock.calls.every((args:any[])=>args[1].status==='failed')).toBe(true);
  });
  it('does not resend an accepted push if its receipt is missing or unavailable',async () => {
    const db=store(); const accepted={...row,ticket_id:'ticket'};
    await checkReceipts([accepted],db,response({}),{},0);
    await checkReceipts([accepted],db,response({},503),{},0);
    expect(db.finish.mock.calls.every((args:any[])=>args[1].status==='accepted')).toBe(true);
  });
  it('marks successful receipts as provider-confirmed',async () => {
    const db=store(); await checkReceipts([{...row,ticket_id:'ticket'}],db,response({ticket:{status:'ok'}}),{},0);
    expect(db.finish).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({status:'confirmed'}));
  });
  it.each([
    ['crew_leave','CrewLeave'],['vessel_tasks','TasksList'],['maintenance_logs','MaintenanceLog'],
    ['yard_period_jobs','YardPeriodJobs'],['watch_keeping_timetables','WatchSchedule'],
    ['trips','UpcomingTrips'],['pre_departure_checklists','ViewPreDepartureChecklist'],
  ])('routes %s to %s without including private notes', (source_table,screen) => {
    const message=notificationMessage({...row,source_table,payload:{...row.payload,title:'Test',notes:'Private note',category:'WEEKLY'}});
    expect(message.data.screen).toBe(screen); expect(message.data.vesselId).toBe('vessel');
    expect(JSON.stringify(message)).not.toContain('Private note');
  });
});
