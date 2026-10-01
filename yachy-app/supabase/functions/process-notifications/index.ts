import { createClient } from 'npm:@supabase/supabase-js@2';
import { isTrustedNotificationRequest } from '../send-trip-push/internal-auth.ts';
import { checkReceipts, sendDeliveries, Delivery, DeliveryStore } from './delivery.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const store: DeliveryStore = {
  async finish(row, patch) {
    const { error } = await db.from('notification_deliveries').update({
      ...patch, lease_id: null, lease_until: null, updated_at: new Date().toISOString(),
    }).eq('id', row.id).eq('lease_id', row.lease_id);
    if (error) throw error;
  },
  async invalidate(row) {
    // Token equality prevents clearing a newer token from this installation.
    const { error } = await db.from('user_devices').update({ expo_push_token: null })
      .eq('user_id', row.recipient_id).eq('expo_push_token', row.token);
    if (error) throw error;
    const { error: legacyError } = await db.from('users').update({ push_token: null })
      .eq('id', row.recipient_id).eq('push_token', row.token);
    if (legacyError) throw legacyError;
  },
};

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!isTrustedNotificationRequest(req.headers, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), Deno.env.get('NOTIFICATION_WORKER_SECRET'))) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const { data: config, error: configError } = await db.from('notification_runtime').select('enabled').eq('id', true).single();
    if (configError) throw configError;
    if (!config.enabled) return Response.json({ enabled: false });
    // Preserve 08:00 UTC reminder timing; the deterministic queue key prevents
    // repeated cron calls delivering the same reminder to the same device.
    if (new Date().getUTCHours() >= 8) {
      const { error } = await db.rpc('enqueue_trip_notification_reminders');
      if (error) throw error;
    }
    const headers: Record<string,string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (Deno.env.get('EXPO_ACCESS_TOKEN')) headers.Authorization = `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}`;
    const { data: pending, error: sendError } = await db.rpc('claim_notification_deliveries', { p_receipts: false });
    if (sendError) throw sendError;
    await sendDeliveries((pending || []) as Delivery[], store, fetch, headers);
    const { data: receipts, error: receiptError } = await db.rpc('claim_notification_deliveries', { p_receipts: true });
    if (receiptError) throw receiptError;
    await checkReceipts((receipts || []) as Delivery[], store, fetch, headers);
    // Keep tokens/payloads only for a bounded operational troubleshooting window.
    const { error: cleanupError } = await db.from('notification_deliveries').delete()
      .in('status', ['confirmed','failed','skipped'])
      .lt('created_at', new Date(Date.now() - 7 * 86400_000).toISOString());
    if (cleanupError) throw cleanupError;
    return Response.json({ processed: pending?.length || 0, receiptsChecked: receipts?.length || 0 });
  } catch (error) {
    console.error('Notification worker failed', { message: error instanceof Error ? error.message : 'Database or delivery failure' });
    return Response.json({ error: 'Notification worker failed; leased work will be retried' }, { status: 500 });
  }
});
