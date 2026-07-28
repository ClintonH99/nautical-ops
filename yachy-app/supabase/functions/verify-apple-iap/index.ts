/**
 * Verify an Apple IAP purchase using the App Store Server API.
 *
 * Unlike the deprecated /verifyReceipt approach, this authenticates
 * directly to Apple with our own signed JWT (private key from App Store
 * Connect), then asks Apple "is this transaction ID real?" - the
 * authenticated HTTPS response from Apple's own server is the trust
 * boundary. Apple's own signed wrapper on the response is decoded
 * (not re-verified against their certificate chain) since we're already
 * on an authenticated channel; full chain verification is a documented
 * hardening option if ever needed.
 *
 * The plan tier/billing period is derived from Apple's verified
 * productId, not trusted from client input - and the calling user is
 * confirmed to actually be CAPTAIN_MOV of the vessel they're claiming,
 * mirroring the same real-permission-check pattern used elsewhere in
 * this project rather than trusting client-side gates alone.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { SignJWT, importPKCS8, decodeJwt } from 'npm:jose@5';

const BUNDLE_ID = 'com.nauticalops.app';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Mirrors APPLE_PRODUCT_IDS in src/constants/subscriptionPlans.ts.
// Kept in sync manually - if product IDs ever change there, update here too.
const PRODUCT_ID_TO_PLAN: Record<string, { planTierId: string; billingPeriodId: string }> = {
  'com.nauticalops.app.crew_1_5_v2.monthly': { planTierId: '1_5', billingPeriodId: 'monthly' },
  'com.nauticalops.app.crew_1_5_v2.3months': { planTierId: '1_5', billingPeriodId: '3_months' },
  'com.nauticalops.app.crew_1_5_v2.6months': { planTierId: '1_5', billingPeriodId: '6_months' },
  'com.nauticalops.app.crew_1_5_v2.12months': { planTierId: '1_5', billingPeriodId: '12_months' },
  'com.nauticalops.app.crew_6_10_v2.monthly': { planTierId: '6_10', billingPeriodId: 'monthly' },
  'com.nauticalops.app.crew_6_10_v2.3months': { planTierId: '6_10', billingPeriodId: '3_months' },
  'com.nauticalops.app.crew_6_10_v2.6months': { planTierId: '6_10', billingPeriodId: '6_months' },
  'com.nauticalops.app.crew_6_10_v2.12months': { planTierId: '6_10', billingPeriodId: '12_months' },
  'com.nauticalops.app.crew_11_15_v2.monthly': { planTierId: '11_15', billingPeriodId: 'monthly' },
  'com.nauticalops.app.crew_11_15_v2.3months': { planTierId: '11_15', billingPeriodId: '3_months' },
  'com.nauticalops.app.crew_11_15_v2.6months': { planTierId: '11_15', billingPeriodId: '6_months' },
  'com.nauticalops.app.crew_16_25_v2.monthly': { planTierId: '16_25', billingPeriodId: 'monthly' },
  'com.nauticalops.app.crew_16_25_v2.3months': { planTierId: '16_25', billingPeriodId: '3_months' },
  'com.nauticalops.app.crew_16_25_v2.6months': { planTierId: '16_25', billingPeriodId: '6_months' },
  'com.nauticalops.app.crew_26_40_v2.monthly': { planTierId: '26_40', billingPeriodId: 'monthly' },
  'com.nauticalops.app.crew_26_40_v2.3months': { planTierId: '26_40', billingPeriodId: '3_months' },
  'com.nauticalops.app.crew_40_plus_v2.monthly': { planTierId: '40_plus', billingPeriodId: 'monthly' },
  'com.nauticalops.app.crew_40_plus_v2.3months': { planTierId: '40_plus', billingPeriodId: '3_months' },
};

async function generateAppleJWT(): Promise<string> {
  const privateKeyPem = Deno.env.get('APPLE_PRIVATE_KEY')!;
  const issuerId = Deno.env.get('APPLE_ISSUER_ID')!;
  const keyId = Deno.env.get('APPLE_KEY_ID')!;
  const privateKey = await importPKCS8(privateKeyPem, 'ES256');
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ bid: BUNDLE_ID })
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
    .setIssuer(issuerId)
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .setAudience('appstoreconnect-v1')
    .sign(privateKey);
}

async function fetchAppleTransaction(transactionId: string, jwt: string): Promise<{ signedTransactionInfo: string } | null> {
  const headers = { Authorization: `Bearer ${jwt}` };
  let res = await fetch(`https://api.storekit.itunes.apple.com/inApps/v1/transactions/${transactionId}`, { headers });
  if (res.status === 404) {
    res = await fetch(`https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/${transactionId}`, { headers });
  }
  if (!res.ok) return null;
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const { transactionId, vesselId } = await req.json();
    console.log('verify-apple-iap: request received', { transactionId, vesselId, userId: user.id });
    if (!transactionId || !vesselId) {
      console.error('verify-apple-iap: missing required fields', { transactionId, vesselId });
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const { data: callerRow, error: callerError } = await supabase
      .from('users')
      .select('vessel_id, role')
      .eq('id', user.id)
      .single();
    if (callerError || !callerRow || callerRow.vessel_id !== vesselId || callerRow.role !== 'CAPTAIN_MOV') {
      console.error('verify-apple-iap: not authorized', { callerError, callerRow, vesselId });
      return new Response(JSON.stringify({ error: 'Not authorized to activate a subscription for this vessel' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const jwt = await generateAppleJWT();
    console.log('verify-apple-iap: generated Apple JWT, length', jwt.length);
    const appleResult = await fetchAppleTransaction(transactionId, jwt);
    if (!appleResult) {
      console.error('verify-apple-iap: Apple did not return a valid transaction for', transactionId);
      return new Response(JSON.stringify({ error: 'Apple could not verify this transaction' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    console.log('verify-apple-iap: Apple responded successfully');

    const payload = decodeJwt(appleResult.signedTransactionInfo) as Record<string, unknown>;
    const productId = payload.productId as string;
    const plan = PRODUCT_ID_TO_PLAN[productId];
    if (!plan) {
      console.error('verify-apple-iap: unknown product ID', productId);
      return new Response(JSON.stringify({ error: `Unknown product ID: ${productId}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const periodStart = new Date(payload.purchaseDate as number).toISOString();
    const periodEnd = new Date(payload.expiresDate as number).toISOString();

    const { error: upsertError } = await supabase
      .from('vessel_subscriptions')
      .upsert(
        {
          vessel_id: vesselId,
          plan_tier: plan.planTierId,
          billing_period: plan.billingPeriodId,
          status: 'active',
          current_period_start: periodStart,
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'vessel_id' }
      );

    if (upsertError) {
      console.error('verify-apple-iap upsert error:', upsertError);
      return new Response(JSON.stringify({ error: 'Failed to activate subscription' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('verify-apple-iap: uncaught error', err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
