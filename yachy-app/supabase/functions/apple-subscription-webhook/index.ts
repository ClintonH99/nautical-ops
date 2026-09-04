/**
 * App Store Server Notifications V2 handler.
 *
 * Deploy without Supabase JWT verification, set APPLE_NOTIFICATION_WEBHOOK_TOKEN,
 * and configure this URL in App Store Connect:
 *   https://<project>.supabase.co/functions/v1/apple-subscription-webhook?token=<secret>
 *
 * The secret rejects unsolicited requests. The transaction ID is then fetched
 * from Apple's authenticated App Store Server API before any database update,
 * so subscription identity, product, vessel token, and dates are not trusted
 * from the incoming request alone.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { SignJWT, importPKCS8, decodeJwt } from 'npm:jose@5';

const BUNDLE_ID = 'com.nauticalops.app';
const GRACE_PERIOD_MS = 16 * 24 * 60 * 60 * 1000;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

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

type AppleNotification = {
  notificationType?: string;
  subtype?: string;
  data?: {
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
};

async function generateAppleJWT(): Promise<string> {
  const privateKey = await importPKCS8(Deno.env.get('APPLE_PRIVATE_KEY')!, 'ES256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ bid: BUNDLE_ID })
    .setProtectedHeader({ alg: 'ES256', kid: Deno.env.get('APPLE_KEY_ID')!, typ: 'JWT' })
    .setIssuer(Deno.env.get('APPLE_ISSUER_ID')!)
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .setAudience('appstoreconnect-v1')
    .sign(privateKey);
}

type AppleSubscriptionStatus = {
  status: number;
  transaction: Record<string, unknown>;
  renewal: Record<string, unknown> | null;
};

async function fetchAppleSubscriptionStatus(
  transactionId: string,
  expectedOriginalTransactionId: string,
  jwt: string
): Promise<AppleSubscriptionStatus | null> {
  const headers = { Authorization: `Bearer ${jwt}` };
  let response = await fetch(
    `https://api.storekit.itunes.apple.com/inApps/v1/subscriptions/${transactionId}`,
    { headers }
  );
  if (response.status === 404) {
    response = await fetch(
      `https://api.storekit-sandbox.itunes.apple.com/inApps/v1/subscriptions/${transactionId}`,
      { headers }
    );
  }
  if (!response.ok) return null;
  const body = (await response.json()) as {
    bundleId?: string;
    data?: Array<{
      lastTransactions?: Array<{
        status?: number;
        signedTransactionInfo?: string;
        signedRenewalInfo?: string;
      }>;
    }>;
  };
  if (body.bundleId !== BUNDLE_ID) return null;

  const candidates = (body.data ?? [])
    .flatMap((group) => group.lastTransactions ?? [])
    .filter((item) => item.signedTransactionInfo)
    .map((item) => ({
      status: Number(item.status),
      transaction: decodeJwt(item.signedTransactionInfo!) as Record<string, unknown>,
      renewal: item.signedRenewalInfo
        ? (decodeJwt(item.signedRenewalInfo) as Record<string, unknown>)
        : null,
    }))
    .filter(
      (item) =>
        PRODUCT_ID_TO_PLAN[item.transaction.productId as string] &&
        item.transaction.originalTransactionId === expectedOriginalTransactionId
    )
    .sort(
      (a, b) => Number(b.transaction.expiresDate ?? 0) - Number(a.transaction.expiresDate ?? 0)
    );

  return candidates[0] ?? null;
}

async function fetchAppleTransaction(
  transactionId: string,
  jwt: string
): Promise<Record<string, unknown> | null> {
  const headers = { Authorization: `Bearer ${jwt}` };
  let response = await fetch(
    `https://api.storekit.itunes.apple.com/inApps/v1/transactions/${transactionId}`,
    { headers }
  );
  if (response.status === 404) {
    response = await fetch(
      `https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/${transactionId}`,
      { headers }
    );
  }
  if (!response.ok) return null;
  const body = (await response.json()) as { signedTransactionInfo?: string };
  return body.signedTransactionInfo
    ? (decodeJwt(body.signedTransactionInfo) as Record<string, unknown>)
    : null;
}

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);

  const expectedToken = Deno.env.get('APPLE_NOTIFICATION_WEBHOOK_TOKEN');
  const suppliedToken =
    new URL(req.url).searchParams.get('token') ?? req.headers.get('x-nautical-ops-webhook-token');
  if (!expectedToken || suppliedToken !== expectedToken) {
    return response({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = (await req.json()) as { signedPayload?: string };
    if (!body.signedPayload) return response({ error: 'Missing signedPayload' }, 400);

    const notification = decodeJwt(body.signedPayload) as AppleNotification;
    const incomingSignedTransaction = notification.data?.signedTransactionInfo;
    if (!incomingSignedTransaction) return response({ received: true, ignored: 'no transaction' });

    const incomingTransaction = decodeJwt(incomingSignedTransaction) as Record<string, unknown>;
    const transactionId = incomingTransaction.transactionId as string | undefined;
    if (!transactionId) return response({ error: 'Missing transaction ID' }, 400);

    const jwt = await generateAppleJWT();
    const authenticatedIncomingTransaction = await fetchAppleTransaction(transactionId, jwt);
    const expectedOriginalTransactionId =
      authenticatedIncomingTransaction?.originalTransactionId as string | undefined;
    if (
      !authenticatedIncomingTransaction ||
      authenticatedIncomingTransaction.bundleId !== BUNDLE_ID ||
      !expectedOriginalTransactionId
    ) {
      return response({ error: 'Apple could not authenticate this transaction' }, 400);
    }

    const currentStatus = await fetchAppleSubscriptionStatus(
      transactionId,
      expectedOriginalTransactionId,
      jwt
    );
    if (!currentStatus || currentStatus.transaction.bundleId !== BUNDLE_ID) {
      return response({ error: 'Apple could not verify this subscription' }, 400);
    }
    const { transaction, renewal, status: appleStatus } = currentStatus;

    const productId = transaction.productId as string;
    const plan = PRODUCT_ID_TO_PLAN[productId];
    const originalTransactionId = transaction.originalTransactionId as string | undefined;
    const latestTransactionId = transaction.transactionId as string | undefined;
    if (!plan || !originalTransactionId || !latestTransactionId) {
      return response({ error: 'Unsupported subscription transaction' }, 400);
    }

    const { data: existing } = await supabase
      .from('vessel_subscriptions')
      .select('vessel_id, status, grace_period_end, billing_retry_started_at')
      .eq('apple_original_transaction_id', originalTransactionId)
      .maybeSingle();

    let vesselId = existing?.vessel_id as string | undefined;
    let pendingPurchaseId: string | null = null;
    if (!vesselId) {
      const appAccountToken = authenticatedIncomingTransaction.appAccountToken as
        | string
        | undefined;
      if (appAccountToken) {
        const { data: pendingPurchase, error: pendingError } = await supabase
          .from('pending_subscription_purchases')
          .select('id, vessel_id, expires_at, consumed_at')
          .eq('id', appAccountToken)
          .eq('provider', 'apple')
          .maybeSingle();
        if (pendingError) throw pendingError;
        if (
          pendingPurchase &&
          !pendingPurchase.consumed_at &&
          new Date(pendingPurchase.expires_at).getTime() > Date.now()
        ) {
          vesselId = pendingPurchase.vessel_id;
          pendingPurchaseId = pendingPurchase.id;
        }
      }
    }

    if (!vesselId) {
      console.warn('Apple subscription notification could not be mapped to a vessel', {
        originalTransactionId,
      });
      return response({ received: true, ignored: 'subscription not linked to a vessel yet' });
    }

    const now = Date.now();
    const expiresAt = Number(transaction.expiresDate);
    const periodStart = new Date(Number(transaction.purchaseDate)).toISOString();
    const periodEnd = new Date(expiresAt).toISOString();
    let status: 'active' | 'past_due' | 'canceled' | 'revoked' = 'canceled';
    let retryStartedAt: string | null = null;
    let gracePeriodEnd: string | null = null;

    if (appleStatus === 1) {
      status = 'active';
    } else if (appleStatus === 4) {
      status = 'past_due';
      retryStartedAt = existing?.billing_retry_started_at ?? new Date().toISOString();
      const appleGraceEnd = Number(renewal?.gracePeriodExpiresDate);
      gracePeriodEnd = new Date(
        Number.isFinite(appleGraceEnd) && appleGraceEnd > 0 ? appleGraceEnd : now + GRACE_PERIOD_MS
      ).toISOString();
    } else if (appleStatus === 3) {
      status = 'past_due';
      retryStartedAt = existing?.billing_retry_started_at ?? new Date().toISOString();
      gracePeriodEnd = existing?.grace_period_end ?? new Date(now + GRACE_PERIOD_MS).toISOString();
    } else if (appleStatus === 5) {
      status = 'revoked';
      gracePeriodEnd = new Date(now).toISOString();
    }

    const { error } = await supabase.rpc('admin_record_apple_subscription', {
      p_vessel_id: vesselId,
      p_plan_tier: plan.planTierId,
      p_billing_period: plan.billingPeriodId,
      p_status: status,
      p_original_transaction_id: originalTransactionId,
      p_latest_transaction_id: latestTransactionId,
      p_current_period_start: periodStart,
      p_current_period_end: periodEnd,
      p_grace_period_end: gracePeriodEnd,
      p_billing_retry_started_at: retryStartedAt,
      p_verified_at: new Date().toISOString(),
      p_pending_purchase_id: pendingPurchaseId,
      p_pending_user_id: null,
    });
    if (error) throw error;

    return response({ received: true });
  } catch (error) {
    console.error('apple-subscription-webhook error', error);
    return response({ error: 'Handler failed' }, 500);
  }
});
