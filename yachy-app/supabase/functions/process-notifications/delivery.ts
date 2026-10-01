// Transport is injected so retries/receipts can be tested without sending pushes.
export interface Delivery {
  id: string; lease_id: string; token: string; recipient_id: string; vessel_id: string;
  source_table: string; source_id: string; event: string; payload: Record<string, string>;
  attempts: number; ticket_id: string | null;
}
export type DeliveryPatch = Record<string, unknown>;
export interface DeliveryStore {
  finish(row: Delivery, patch: DeliveryPatch): Promise<void>;
  invalidate(row: Delivery): Promise<void>;
}
const after = (now: number, ms: number) => new Date(now + ms).toISOString();
const short = (value?: string) => (value || '').replace(/[\r\n]+/g, ' ').slice(0, 120);

export function notificationMessage(row: Delivery) {
  const p = row.payload;
  const changed = row.event === 'updated';
  const data: Record<string, string> = { notificationId: row.id, vesselId: row.vessel_id };
  let title: string;
  let body = 'Tap to view.';
  switch (row.source_table) {
    case 'crew_leave': {
      const labels: Record<string,string> = { ANNUAL: 'Annual leave', SICK: 'Sick leave', ROTATION: 'Rotation leave', OTHER: 'Leave' };
      title = changed ? 'Crew leave updated' : 'Crew leave published';
      body = `${labels[p.leave_type] || 'Leave'}: ${short(p.start_date)} – ${short(p.end_date)}. Tap to view.`;
      data.screen = 'CrewLeave'; data.crewLeaveId = row.source_id; break;
    }
    case 'vessel_tasks':
      title = `${changed ? 'Task updated' : 'New task'}: ${short(p.title)}`;
      data.screen = 'TasksList'; data.category = p.category; break;
    case 'maintenance_logs':
      title = `${changed ? 'Maintenance log updated' : 'New maintenance log'}: ${short(p.title)}`;
      data.screen = 'MaintenanceLog'; break;
    case 'yard_period_jobs':
      title = `${changed ? 'Shipyard job updated' : 'New shipyard job'}: ${short(p.title)}`;
      data.screen = 'YardPeriodJobs'; break;
    case 'watch_keeping_timetables':
      title = `${changed ? 'Watch schedule updated' : 'Watch schedule published'}: ${short(p.title)}`;
      data.screen = 'WatchSchedule'; data.timetableId = row.source_id; break;
    case 'pre_departure_checklists':
      title = 'Pre-departure checklist'; body = 'A checklist has been linked to a trip. Tap to view.';
      data.screen = 'ViewPreDepartureChecklist'; data.checklistId = row.source_id; break;
    case 'trips':
      title = `${row.event === 'reminder' ? 'Trip tomorrow' : changed ? 'Trip updated' : 'New trip'}: ${short(p.title)}`;
      body = `${short(p.start_date)} – ${short(p.end_date)}. Tap to view.`;
      data.screen = 'UpcomingTrips'; break;
    default: throw new Error('Unsupported notification source');
  }
  return { to: row.token, title, body, data, sound: 'default' };
}

const permanent = new Set(['DeviceNotRegistered','MessageTooBig','MismatchSenderId','InvalidCredentials']);
function failure(row: Delivery, reason: string, now: number, retryable = true): DeliveryPatch {
  return {
    status: retryable && row.attempts < 5 ? 'pending' : 'failed',
    ticket_id: null, last_error: reason.slice(0, 180),
    available_at: after(now, Math.min(60 * 60_000, 60_000 * 2 ** row.attempts)),
  };
}

export async function sendDeliveries(
  rows: Delivery[], store: DeliveryStore, request: typeof fetch, headers: Record<string,string>, now = Date.now()
) {
  if (!rows.length) return;
  let tickets: any[];
  try {
    const response = await request('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers, body: JSON.stringify(rows.map(notificationMessage)),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      for (const row of rows) await store.finish(row, failure(row, `Expo HTTP ${response.status}`, now,
        response.status === 429 || response.status >= 500));
      return;
    }
    const result = await response.json();
    tickets = result.data;
    if (!Array.isArray(tickets) || tickets.length !== rows.length) throw new Error('Invalid Expo tickets');
  } catch {
    // An ambiguous network failure may have reached Expo. At-least-once delivery
    // is intentional; notificationId is stable across attempts, never claim exactly-once.
    for (const row of rows) await store.finish(row, failure(row, 'Expo network or response error', now));
    return;
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]; const ticket = tickets[i];
    if (ticket?.status === 'ok' && typeof ticket.id === 'string') {
      await store.finish(row, { status: 'accepted', ticket_id: ticket.id, last_error: null, available_at: after(now, 15 * 60_000) });
    } else {
      const reason = ticket?.details?.error || 'Invalid Expo ticket';
      if (reason === 'DeviceNotRegistered') await store.invalidate(row);
      await store.finish(row, failure(row, reason, now, !permanent.has(reason)));
    }
  }
}

export async function checkReceipts(
  rows: Delivery[], store: DeliveryStore, request: typeof fetch, headers: Record<string,string>, now = Date.now()
) {
  if (!rows.length) return;
  let receipts: Record<string, any>;
  try {
    const response = await request('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST', headers, body: JSON.stringify({ ids: rows.map(row => row.ticket_id) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error('Receipt lookup unavailable');
    const result = await response.json();
    if (!result.data || typeof result.data !== 'object') throw new Error('Invalid receipt response');
    receipts = result.data;
  } catch {
    // Never resend an accepted notification merely because receipt lookup failed.
    for (const row of rows) await store.finish(row, { status: 'accepted', available_at: after(now, 15 * 60_000), last_error: 'Receipt lookup unavailable' });
    return;
  }
  for (const row of rows) {
    const receipt = row.ticket_id ? receipts[row.ticket_id] : null;
    if (!receipt) {
      await store.finish(row, { status: 'accepted', available_at: after(now, 15 * 60_000), last_error: 'Receipt pending' });
    } else if (receipt.status === 'ok') {
      // Confirms handoff to APNs/FCM, not display/read on the user's phone.
      await store.finish(row, { status: 'confirmed', last_error: null });
    } else {
      const reason = receipt?.details?.error || 'Unknown receipt error';
      if (reason === 'DeviceNotRegistered') await store.invalidate(row);
      await store.finish(row, failure(row, reason, now, !permanent.has(reason)));
    }
  }
}
