/**
 * Edge Function: Send trip push notifications
 *
 * Triggered by:
 * 1. Database Webhook on trips INSERT → immediate "new trip" notification
 * 2. Cron job (daily) → "day before" reminder for trips starting tomorrow
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

interface TripRecord {
  id: string;
  vessel_id: string;
  type: string;
  title: string;
  start_date: string;
  end_date: string;
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: TripRecord;
  schema: string;
  old_record: TripRecord | null;
}

type TripPayload = { trip: TripRecord } | { type: 'reminders' };

async function sendToExpo(messages: { to: string; title: string; body: string }[]) {
  if (messages.length === 0) return [];
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const token = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const body = messages.map((m) => ({
    to: m.to,
    title: m.title,
    body: m.body,
    sound: 'default',
  }));

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getVesselUsersWithTripsEnabled(vesselId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('id, push_token, notification_preferences')
    .eq('vessel_id', vesselId)
    .not('push_token', 'is', null);

  if (error) return [];
  return (data || []).filter((u: any) => {
    const prefs = u.notification_preferences || {};
    return prefs.trips !== false;
  });
}

/** Users with trips OR preDeparture enabled (for day-before reminders including checklist) */
async function getVesselUsersForDayBeforeReminder(vesselId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('id, push_token, notification_preferences')
    .eq('vessel_id', vesselId)
    .not('push_token', 'is', null);

  if (error) return [];
  return (data || []).filter((u: any) => {
    const prefs = u.notification_preferences || {};
    return prefs.trips !== false || prefs.preDeparture !== false;
  });
}

function formatTripType(type: string): string {
  const map: Record<string, string> = {
    GUEST: 'Guest',
    BOSS: 'Boss',
    DELIVERY: 'Delivery',
    YARD_PERIOD: 'Yard period',
  };
  return map[type] || type;
}

Deno.serve(async (req) => {
  try {
    // Cron sends POST with { type: "reminders" }
    const body = await req.json();

    if (body?.type === 'reminders') {
      // Day-before reminders: trips starting tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);

      const { data: trips } = await supabase
        .from('trips')
        .select('id, vessel_id, type, title, start_date')
        .eq('start_date', tomorrowStr);

      if (!trips?.length) {
        return new Response(JSON.stringify({ sent: 0, message: 'No trips tomorrow' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const allMessages: { to: string; title: string; body: string }[] = [];
      for (const trip of trips) {
        const users = await getVesselUsersForDayBeforeReminder(trip.vessel_id);
        const typeLabel = formatTripType(trip.type);
        const title = `Trip tomorrow: ${trip.title}`;
        const bodyText = `${typeLabel} trip starts tomorrow. Review your pre-departure checklist.`;
        for (const u of users) {
          if (u.push_token) allMessages.push({ to: u.push_token, title, body: bodyText });
        }
      }

      const result = await sendToExpo(allMessages);
      return new Response(
        JSON.stringify({ sent: allMessages.length, result }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Database Webhook payload (trips INSERT)
    const payload = body as WebhookPayload;
    if (payload?.table !== 'trips' || payload?.type !== 'INSERT' || !payload?.record) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload: expected trips INSERT' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const trip = payload.record;
    const users = await getVesselUsersWithTripsEnabled(trip.vessel_id);
    const messages = users
      .filter((u: any) => u.push_token)
      .map((u: any) => ({ to: u.push_token, title: `New trip: ${trip.title}`, body: `Urgent: ${formatTripType(trip.type)} trip added. ${trip.start_date} – ${trip.end_date}. Tap to view.` }));

    console.log('Trip insert:', {
      tripId: trip.id,
      vesselId: trip.vessel_id,
      usersFound: users.length,
      messagesToSend: messages.length,
      pushTokens: users.map((u: any) => (u.push_token ? u.push_token.slice(0, 30) + '...' : null)),
    });

    const result = await sendToExpo(messages);
    return new Response(
      JSON.stringify({
        sent: messages.length,
        debug: { vesselId: trip.vessel_id, usersFound: users.length },
        result,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('send-trip-push error:', e);
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
