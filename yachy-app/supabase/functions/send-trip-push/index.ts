/**
 * Send vessel trip, linked pre-departure checklist, and crew leave notifications.
 *
 * Accepted calls:
 * - Database Webhook: trips INSERT or UPDATE
 * - Database Webhook: pre_departure_checklists INSERT or UPDATE
 * - Scheduled POST: { "type": "reminders" }
 * - Authenticated app POST: { "type": "crew_leave", "crewLeaveId": "...", "event": "created" | "updated" }
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildChecklistNotification,
  buildCrewLeaveNotification,
  buildDayBeforeNotification,
  buildTripNotification,
  ChecklistNotificationRecord,
  CrewLeaveNotificationRecord,
  collectNotificationRecipients,
  NotificationPreferenceRule,
  NotificationRecipient,
  PushContent,
  TripNotificationRecord,
} from './notification-logic.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isTrustedInternalRequest(req: Request): boolean {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  return !!serviceRoleKey && req.headers.get('Authorization') === `Bearer ${serviceRoleKey}`;
}

interface WebhookPayload<RecordType = Record<string, unknown>> {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: RecordType;
  schema: string;
  old_record: RecordType | null;
}

interface PushEnvelope extends PushContent {
  recipient: NotificationRecipient;
}

async function getVesselRecipients(
  vesselId: string,
  preferenceRule: NotificationPreferenceRule
): Promise<NotificationRecipient[]> {
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, push_token, notification_preferences')
    .eq('vessel_id', vesselId);

  if (usersError) throw usersError;

  if (!users?.length) return [];

  const userIds = users.map((user: any) => user.id);
  const { data: devices, error: devicesError } = await supabase
    .from('user_devices')
    .select('user_id, expo_push_token')
    .in('user_id', userIds)
    .is('revoked_at', null)
    .not('expo_push_token', 'is', null);

  if (devicesError) throw devicesError;

  return collectNotificationRecipients(users as any[], devices || [], preferenceRule);
}

async function getUserRecipients(
  userId: string,
  preferenceRule: NotificationPreferenceRule
): Promise<NotificationRecipient[]> {
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, push_token, notification_preferences')
    .eq('id', userId);
  if (usersError) throw usersError;
  if (!users?.length) return [];

  const { data: devices, error: devicesError } = await supabase
    .from('user_devices')
    .select('user_id, expo_push_token')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .not('expo_push_token', 'is', null);
  if (devicesError) throw devicesError;

  return collectNotificationRecipients(users as any[], devices || [], preferenceRule);
}

async function clearInvalidRecipient(recipient: NotificationRecipient): Promise<void> {
  if (recipient.source === 'device') {
    await supabase
      .from('user_devices')
      .update({ expo_push_token: null, push_token_updated_at: new Date().toISOString() })
      .eq('user_id', recipient.userId)
      .eq('expo_push_token', recipient.token);
    return;
  }

  await supabase
    .from('users')
    .update({ push_token: null })
    .eq('id', recipient.userId)
    .eq('push_token', recipient.token);
}

async function sendToExpo(messages: PushEnvelope[]) {
  if (messages.length === 0) return { accepted: 0, rejected: 0 };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let accepted = 0;
  let rejected = 0;

  for (let start = 0; start < messages.length; start += 100) {
    const batch = messages.slice(start, start + 100);
    const body = batch.map((message) => ({
      to: message.recipient.token,
      title: message.title,
      body: message.body,
      data: message.data,
      sound: 'default',
    }));

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Expo push request failed with status ${response.status}`);
    }

    const result = await response.json();
    const tickets = Array.isArray(result?.data) ? result.data : [];
    if (tickets.length !== batch.length) {
      throw new Error('Expo returned an unexpected number of push tickets');
    }

    for (let index = 0; index < tickets.length; index += 1) {
      const ticket = tickets[index];
      if (ticket?.status === 'ok') {
        accepted += 1;
        continue;
      }

      rejected += 1;
      console.warn('Expo rejected push notification:', {
        error: ticket?.details?.error,
        message: ticket?.message,
        userId: batch[index].recipient.userId,
      });
      if (ticket?.details?.error === 'DeviceNotRegistered') {
        await clearInvalidRecipient(batch[index].recipient);
      }
    }
  }

  return { accepted, rejected };
}

function envelopes(recipients: NotificationRecipient[], content: PushContent): PushEnvelope[] {
  return recipients.map((recipient) => ({ ...content, recipient }));
}

async function sendDayBeforeReminders() {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);

  const { data: trips, error } = await supabase
    .from('trips')
    .select('id, vessel_id, type, title, start_date, end_date')
    .eq('start_date', tomorrowDate);
  if (error) throw error;

  const messages: PushEnvelope[] = [];
  for (const trip of (trips || []) as TripNotificationRecord[]) {
    const recipients = await getVesselRecipients(trip.vessel_id, 'dayBefore');
    messages.push(...envelopes(recipients, buildDayBeforeNotification(trip)));
  }

  return {
    scheduledDate: tomorrowDate,
    notifications: messages.length,
    ...(await sendToExpo(messages)),
  };
}

async function sendTripWebhook(payload: WebhookPayload<TripNotificationRecord>) {
  if (payload.type !== 'INSERT' && payload.type !== 'UPDATE') {
    return jsonResponse({ ignored: true, reason: 'Trip event is not INSERT or UPDATE' });
  }

  const trip = payload.record;
  const recipients = await getVesselRecipients(trip.vessel_id, 'trips');
  const content = buildTripNotification(trip, payload.type === 'INSERT' ? 'created' : 'updated');
  const messages = envelopes(recipients, content);
  const result = await sendToExpo(messages);

  console.log('Trip notification processed:', {
    event: payload.type,
    tripId: trip.id,
    vesselId: trip.vessel_id,
    recipients: messages.length,
    ...result,
  });
  return jsonResponse({ sent: messages.length, ...result });
}

async function sendChecklistWebhook(
  payload: WebhookPayload<ChecklistNotificationRecord>
): Promise<Response> {
  const checklist = payload.record;
  const newlyLinked =
    !!checklist?.trip_id &&
    (payload.type === 'INSERT' ||
      (payload.type === 'UPDATE' && checklist.trip_id !== payload.old_record?.trip_id));

  if (!newlyLinked) {
    return jsonResponse({ ignored: true, reason: 'Checklist was not newly linked to a trip' });
  }

  const { data: trip, error } = await supabase
    .from('trips')
    .select('id, vessel_id, type, title, start_date, end_date')
    .eq('id', checklist.trip_id)
    .eq('vessel_id', checklist.vessel_id)
    .single();
  if (error || !trip) throw error || new Error('Linked trip not found');

  const recipients = await getVesselRecipients(checklist.vessel_id, 'preDeparture');
  const messages = envelopes(
    recipients,
    buildChecklistNotification(checklist, trip as TripNotificationRecord)
  );
  const result = await sendToExpo(messages);

  console.log('Checklist notification processed:', {
    event: payload.type,
    checklistId: checklist.id,
    tripId: checklist.trip_id,
    vesselId: checklist.vessel_id,
    recipients: messages.length,
    ...result,
  });
  return jsonResponse({ sent: messages.length, ...result });
}

async function getAuthenticatedActor(req: Request) {
  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token || token === authorization) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } } }
  );
  const { data: deviceAllowed, error: deviceError } = await userClient.rpc(
    'current_session_has_device_access'
  );
  if (deviceError || deviceAllowed !== true) return null;

  const { data: actor, error: actorError } = await supabase
    .from('users')
    .select('id, vessel_id, role')
    .eq('id', data.user.id)
    .single();
  if (actorError || !actor) return null;
  return actor as { id: string; vessel_id: string | null; role: string };
}

async function sendCrewLeaveRequest(
  req: Request,
  body: Record<string, unknown>
): Promise<Response> {
  const crewLeaveId = typeof body.crewLeaveId === 'string' ? body.crewLeaveId : null;
  const event = body.event === 'updated' ? 'updated' : body.event === 'created' ? 'created' : null;
  if (!crewLeaveId || !event) return jsonResponse({ error: 'Invalid crew leave request' }, 400);

  const actor = await getAuthenticatedActor(req);
  if (!actor || !['HOD', 'CAPTAIN_MOV'].includes(actor.role)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const { data: leave, error } = await supabase
    .from('crew_leave')
    .select('id, vessel_id, crew_member_id, leave_type, start_date, end_date')
    .eq('id', crewLeaveId)
    .single();
  if (error || !leave) return jsonResponse({ error: 'Crew leave not found' }, 404);
  if (!actor.vessel_id || actor.vessel_id !== leave.vessel_id) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // Historical leave survives account deletion. There is nobody to notify
  // once the referenced crew profile has been removed.
  if (!leave.crew_member_id) {
    return jsonResponse({ sent: 0, accepted: 0, rejected: 0 });
  }

  const recipients = await getUserRecipients(leave.crew_member_id, 'crewLeave');
  const content = buildCrewLeaveNotification(leave as CrewLeaveNotificationRecord, event);
  const messages = envelopes(recipients, content);
  const result = await sendToExpo(messages);

  console.log('Crew leave notification processed:', {
    event,
    crewLeaveId,
    vesselId: leave.vessel_id,
    recipientUserId: leave.crew_member_id,
    recipients: messages.length,
    ...result,
  });
  return jsonResponse({ sent: messages.length, ...result });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json();
    if (body?.type === 'crew_leave') return await sendCrewLeaveRequest(req, body);

    if (!isTrustedInternalRequest(req)) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (body?.type === 'reminders') return jsonResponse(await sendDayBeforeReminders());

    const payload = body as WebhookPayload;
    if (!payload?.record || !payload?.table) {
      return jsonResponse({ error: 'Invalid database webhook payload' }, 400);
    }
    if (payload.table === 'trips') {
      return await sendTripWebhook(payload as WebhookPayload<TripNotificationRecord>);
    }
    if (payload.table === 'pre_departure_checklists') {
      return await sendChecklistWebhook(payload as WebhookPayload<ChecklistNotificationRecord>);
    }

    return jsonResponse({ error: 'Unsupported webhook table' }, 400);
  } catch (error) {
    console.error('send-trip-push error:', error);
    return jsonResponse({ error: 'Could not send notifications' }, 500);
  }
});
