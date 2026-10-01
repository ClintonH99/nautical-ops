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
import { fetchCurrentAppleStatus } from '../_shared/appleStatus.ts';
import { appleRenewalStatus } from '../_shared/appleRenewal.ts';

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
  'com.nauticalops.app.crew_40_plus_v2.monthly': {
    planTierId: '40_plus',
    billingPeriodId: 'monthly',
  },
  'com.nauticalops.app.crew_40_plus_v2.3months': {
    planTierId: '40_plus',
    billingPeriodId: '3_months',
  },
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

async function fetchAppleTransaction(
  transactionId: string,
  jwt: string
): Promise<{ signedTransactionInfo: string } | null> {
  const headers = { Authorization: `Bearer ${jwt}` };
  let res = await fetch(
    `https://api.storekit.itunes.apple.com/inApps/v1/transactions/${transactionId}`,
    { headers }
  );
  if (res.status === 404) {
    res = await fetch(
      `https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/${transactionId}`,
      { headers }
    );
  }
  if (!res.ok) return null;
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.slice(7);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const {
      transactionId: requestedTransactionId,
      vesselId,
      refreshOnly = false,
    } = await req.json();
    if ((!requestedTransactionId && !refreshOnly) || !vesselId) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: callerRow, error: callerError } = await supabase
      .from('users')
      .select('vessel_id, role')
      .eq('id', user.id)
      .single();
    if (
      callerError ||
      !callerRow ||
      callerRow.vessel_id !== vesselId ||
      callerRow.role !== 'CAPTAIN_MOV'
    ) {
      console.error('verify-apple-iap: caller is not authorized for the requested vessel');
      return new Response(
        JSON.stringify({ error: 'Not authorized to activate a subscription for this vessel' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let transactionId = requestedTransactionId;
    let existingSubscription: any = null;
    if (refreshOnly) {
      // Never accept a transaction ID from the refresh caller. Only refresh the
      // chain already bound to their vessel, after checking Captain/MOV above.
      const { data, error } = await supabase
        .from('vessel_subscriptions')
        .select(
          'apple_latest_transaction_id, apple_original_transaction_id, grace_period_end, billing_retry_started_at'
        )
        .eq('vessel_id', vesselId)
        .eq('payment_provider', 'apple')
        .maybeSingle();
      if (error) throw error;
      existingSubscription = data;
      transactionId = data?.apple_latest_transaction_id ?? data?.apple_original_transaction_id;
      if (!transactionId)
        return new Response(JSON.stringify({ success: true, refreshed: false }), {
          headers: { 'Content-Type': 'application/json' },
        });
    }
    const jwt = await generateAppleJWT();
    const appleResult = await fetchAppleTransaction(transactionId, jwt);
    if (!appleResult) {
      console.error(
        'verify-apple-iap: Apple did not return a valid transaction for',
        'requested transaction'
      );
      return new Response(JSON.stringify({ error: 'Apple could not verify this transaction' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const purchasedPayload = decodeJwt(appleResult.signedTransactionInfo) as Record<
      string,
      unknown
    >;
    if (purchasedPayload.bundleId !== BUNDLE_ID || !purchasedPayload.originalTransactionId) {
      throw new Error('Invalid Apple subscription identity');
    }
    const current = await fetchCurrentAppleStatus(
      transactionId,
      purchasedPayload.originalTransactionId as string,
      jwt,
      BUNDLE_ID
    );
    const payload = current.transaction;
    const confirmedStatus = appleRenewalStatus(current.status, current.renewal?.autoRenewStatus);
    if (payload.bundleId !== BUNDLE_ID) {
      console.error('verify-apple-iap: bundle ID mismatch', payload.bundleId);
      return new Response(JSON.stringify({ error: 'Transaction belongs to a different app' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const productId = payload.productId as string;
    const plan = PRODUCT_ID_TO_PLAN[productId];
    if (!plan) {
      console.error('verify-apple-iap: unknown product ID', productId);
      return new Response(JSON.stringify({ error: `Unknown product ID: ${productId}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const periodStart = new Date(payload.purchaseDate as number).toISOString();
    const periodEnd = new Date(payload.expiresDate as number).toISOString();
    const originalTransactionId = payload.originalTransactionId as string;
    const latestTransactionId = payload.transactionId as string;
    const isRevoked = Boolean(payload.revocationDate);
    const isCurrent = !isRevoked && Number(payload.expiresDate) > Date.now();

    if (!originalTransactionId || !latestTransactionId) {
      return new Response(
        JSON.stringify({ error: 'Apple transaction is missing subscription identifiers' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Restore can surface historical transactions in the same subscription
    // chain. Never let an older expired transaction overwrite a newer active
    // period; background App Store notifications own expiration updates.
    if (!isCurrent && !refreshOnly) {
      return new Response(
        JSON.stringify({ error: 'This Apple subscription is no longer active' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: existingTransaction, error: existingTransactionError } = await supabase
      .from('vessel_subscriptions')
      .select('vessel_id')
      .eq('apple_original_transaction_id', originalTransactionId)
      .maybeSingle();
    if (existingTransactionError) throw existingTransactionError;
    if (existingTransaction && existingTransaction.vessel_id !== vesselId) {
      return new Response(
        JSON.stringify({ error: 'This Apple subscription is already linked to another vessel' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Existing subscription chains can be restored to the vessel they are
    // already bound to. A new chain must carry either a short-lived token that
    // our server issued for this user/vessel, or the legacy vessel-ID token
    // used by already-released app versions.
    let pendingPurchaseId: string | null = null;
    if (!existingTransaction) {
      const appAccountToken = purchasedPayload.appAccountToken as string | undefined;
      if (!appAccountToken) {
        return new Response(
          JSON.stringify({ error: 'Purchase is missing its secure account link' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (appAccountToken !== vesselId) {
        const { data: pendingPurchase, error: pendingError } = await supabase
          .from('pending_subscription_purchases')
          .select('id, user_id, vessel_id, expires_at, consumed_at')
          .eq('id', appAccountToken)
          .eq('provider', 'apple')
          .maybeSingle();
        if (pendingError) throw pendingError;
        if (
          !pendingPurchase ||
          pendingPurchase.user_id !== user.id ||
          pendingPurchase.vessel_id !== vesselId ||
          pendingPurchase.consumed_at ||
          new Date(pendingPurchase.expires_at).getTime() <= Date.now()
        ) {
          return new Response(
            JSON.stringify({ error: 'Purchase account link is invalid or expired' }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          );
        }
        pendingPurchaseId = pendingPurchase.id;
      }
    }

    const { error: activationError } = await supabase.rpc('admin_record_apple_subscription', {
      p_vessel_id: vesselId,
      p_plan_tier: plan.planTierId,
      p_billing_period: plan.billingPeriodId,
      p_status: confirmedStatus,
      p_original_transaction_id: originalTransactionId,
      p_latest_transaction_id: latestTransactionId,
      p_current_period_start: periodStart,
      p_current_period_end: periodEnd,
      p_grace_period_end:
        confirmedStatus === 'past_due'
          ? Number(current.renewal?.gracePeriodExpiresDate) > 0
            ? new Date(Number(current.renewal?.gracePeriodExpiresDate)).toISOString()
            : (existingSubscription?.grace_period_end ??
              new Date(Date.now() + 16 * 86400000).toISOString())
          : null,
      p_billing_retry_started_at:
        confirmedStatus === 'past_due'
          ? (existingSubscription?.billing_retry_started_at ?? new Date().toISOString())
          : null,
      p_verified_at: new Date().toISOString(),
      p_pending_purchase_id: pendingPurchaseId,
      p_pending_user_id: pendingPurchaseId ? user.id : null,
    });

    if (activationError) {
      console.error('verify-apple-iap activation failed:', activationError.code);
      return new Response(JSON.stringify({ error: 'Failed to activate subscription' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(
      'verify-apple-iap: uncaught error',
      err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err
    );
    return new Response(JSON.stringify({ error: 'Verification failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
