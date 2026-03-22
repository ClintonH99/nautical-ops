/**
 * Paddle Billing webhook handler.
 * Configure in Paddle Dashboard: Developer tools > Notifications > destination URL:
 *   https://<project>.supabase.co/functions/v1/paddle-webhook
 *
 * Secret: PADDLE_WEBHOOK_SECRET (endpoint secret key from Paddle)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const VALID_PLAN_TIERS = new Set(['1_5', '6_10', '11_15', '16_25', '26_40', '40_plus']);
const VALID_BILLING = new Set(['monthly', '3_months', '6_months', '12_months']);

type SubStatus = 'active' | 'past_due' | 'canceled' | 'trialing';

interface CustomData {
  vessel_id?: string;
  plan_tier?: string;
  billing_period?: string;
  user_id?: string;
}

function parsePaddleSignature(header: string | null): { ts: string; h1: string } | null {
  if (!header) return null;
  let ts = '';
  let h1 = '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 'ts') ts = v;
    if (k === 'h1') h1 = v;
  }
  return ts && h1 ? { ts, h1 } : null;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): Promise<boolean> {
  const parsed = parsePaddleSignature(signatureHeader);
  if (!parsed) return false;
  const now = Math.floor(Date.now() / 1000);
  const tsNum = parseInt(parsed.ts, 10);
  if (Number.isNaN(tsNum) || Math.abs(now - tsNum) > 300) {
    console.warn('Paddle webhook timestamp outside tolerance');
    return false;
  }
  const expected = await hmacSha256Hex(secret, `${parsed.ts}:${rawBody}`);
  return timingSafeEqualHex(expected.toLowerCase(), parsed.h1.toLowerCase());
}

function mapPaddleStatus(paddleStatus: string): SubStatus {
  switch (paddleStatus) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'paused':
      return 'active';
    default:
      return 'canceled';
  }
}

function periodFromSubscription(sub: Record<string, unknown>): { start: string; end: string } {
  const cbp = sub.current_billing_period as
    | { starts_at?: string; ends_at?: string }
    | null
    | undefined;
  if (cbp?.starts_at && cbp?.ends_at) {
    return { start: cbp.starts_at, end: cbp.ends_at };
  }
  const started = (sub.started_at as string) || new Date().toISOString();
  const next = sub.next_billed_at as string | null | undefined;
  if (next) {
    return { start: started, end: next };
  }
  const end = new Date(started);
  end.setMonth(end.getMonth() + 1);
  return { start: started, end: end.toISOString() };
}

function periodFromTransaction(txn: Record<string, unknown>): { start: string; end: string } {
  const bp = txn.billing_period as { starts_at?: string; ends_at?: string } | null | undefined;
  if (bp?.starts_at && bp?.ends_at) {
    return { start: bp.starts_at, end: bp.ends_at };
  }
  const now = new Date();
  const end = new Date(now);
  end.setMonth(end.getMonth() + 1);
  return { start: now.toISOString(), end: end.toISOString() };
}

function readCustomData(obj: Record<string, unknown>): CustomData {
  const cd = obj.custom_data as CustomData | null | undefined;
  return cd && typeof cd === 'object' ? cd : {};
}

async function upsertVesselSubscription(params: {
  vesselId: string;
  planTier: string;
  billingPeriod: string;
  status: SubStatus;
  paddleSubscriptionId: string | null;
  paddleCustomerId: string | null;
  periodStart: string;
  periodEnd: string;
}) {
  if (!VALID_PLAN_TIERS.has(params.planTier) || !VALID_BILLING.has(params.billingPeriod)) {
    console.error('Invalid plan or billing from webhook', params.planTier, params.billingPeriod);
    return;
  }

  const { error } = await supabaseAdmin.from('vessel_subscriptions').upsert(
    {
      vessel_id: params.vesselId,
      plan_tier: params.planTier,
      billing_period: params.billingPeriod,
      status: params.status,
      paddle_subscription_id: params.paddleSubscriptionId,
      paddle_customer_id: params.paddleCustomerId,
      current_period_start: params.periodStart,
      current_period_end: params.periodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'vessel_id' }
  );
  if (error) console.error('vessel_subscriptions upsert error:', error);
}

async function updateByPaddleSubscriptionId(
  paddleSubId: string,
  patch: {
    status?: SubStatus;
    periodStart?: string;
    periodEnd?: string;
    paddleCustomerId?: string | null;
  }
) {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.periodStart !== undefined) row.current_period_start = patch.periodStart;
  if (patch.periodEnd !== undefined) row.current_period_end = patch.periodEnd;
  if (patch.paddleCustomerId !== undefined) row.paddle_customer_id = patch.paddleCustomerId;

  const { error } = await supabaseAdmin
    .from('vessel_subscriptions')
    .update(row)
    .eq('paddle_subscription_id', paddleSubId);
  if (error) console.error('vessel_subscriptions update error:', error);
}

async function handleSubscriptionPayload(sub: Record<string, unknown>, defaultStatus?: SubStatus) {
  const cd = readCustomData(sub);
  let vesselId = cd.vessel_id;
  let planTier = cd.plan_tier;
  let billingPeriod = cd.billing_period;

  const paddleSubId = sub.id as string;
  const customerId = (sub.customer_id as string) || null;
  const status = defaultStatus ?? mapPaddleStatus((sub.status as string) || 'canceled');
  const { start, end } = periodFromSubscription(sub);

  if (!vesselId || !planTier || !billingPeriod) {
    if (paddleSubId) {
      const { data: existing } = await supabaseAdmin
        .from('vessel_subscriptions')
        .select('vessel_id, plan_tier, billing_period')
        .eq('paddle_subscription_id', paddleSubId)
        .maybeSingle();
      if (existing) {
        await updateByPaddleSubscriptionId(paddleSubId, {
          status,
          periodStart: start,
          periodEnd: end,
          paddleCustomerId: customerId,
        });
      }
    }
    return;
  }

  await upsertVesselSubscription({
    vesselId,
    planTier,
    billingPeriod,
    status,
    paddleSubscriptionId: paddleSubId,
    paddleCustomerId: customerId,
    periodStart: start,
    periodEnd: end,
  });
}

async function handleTransactionCompleted(txn: Record<string, unknown>) {
  const cd = readCustomData(txn);
  const vesselId = cd.vessel_id;
  const planTier = cd.plan_tier;
  const billingPeriod = cd.billing_period;
  if (!vesselId || !planTier || !billingPeriod) {
    console.warn('transaction.completed missing custom_data for provisioning');
    return;
  }

  const subscriptionId = (txn.subscription_id as string) || null;
  const customerId = (txn.customer_id as string) || null;
  const { start, end } = periodFromTransaction(txn);

  await upsertVesselSubscription({
    vesselId,
    planTier,
    billingPeriod,
    status: 'active',
    paddleSubscriptionId: subscriptionId,
    paddleCustomerId: customerId,
    periodStart: start,
    periodEnd: end,
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const secret = Deno.env.get('PADDLE_WEBHOOK_SECRET');
  if (!secret) {
    console.error('PADDLE_WEBHOOK_SECRET not set');
    return new Response('Webhook not configured', { status: 503 });
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get('paddle-signature') || req.headers.get('Paddle-Signature');

  const ok = await verifyPaddleSignature(rawBody, sigHeader, secret);
  if (!ok) {
    console.error('Invalid Paddle webhook signature');
    return new Response('Invalid signature', { status: 400 });
  }

  let payload: { event_type?: string; data?: Record<string, unknown> };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const eventType = payload.event_type;
  const data = payload.data;

  try {
    if (!data || typeof data !== 'object') {
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    switch (eventType) {
      case 'subscription.created':
      case 'subscription.activated':
      case 'subscription.resumed':
        await handleSubscriptionPayload(data, 'active');
        break;
      case 'subscription.trialing':
        await handleSubscriptionPayload(data, 'trialing');
        break;
      case 'subscription.updated':
        await handleSubscriptionPayload(data);
        break;
      case 'subscription.past_due':
        await handleSubscriptionPayload(data, 'past_due');
        break;
      case 'subscription.canceled':
        await handleSubscriptionPayload(data, 'canceled');
        break;
      case 'transaction.completed':
        await handleTransactionCompleted(data);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('paddle-webhook handler error:', err);
    return new Response('Handler failed', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
