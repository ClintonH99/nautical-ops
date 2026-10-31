import {
  BillingError,
  paddleConfig,
  paddleRequest,
  validatePrice,
  checkoutPage,
  checkoutResult,
} from './paddle.mjs';
import { requirePaddleBilling, requirePaddleTester } from './paddleRollout.mjs';

// Preparing a transaction is not a payment. Only the signed, payment-verified
// subscription webhook may replace the old entitlement. No automatic retries.
export function createPaddleReactivationHandler({
  getEnv,
  createClient,
  fetcher = fetch,
  now = Date.now,
}) {
  return async (request) => {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    try {
      const environment = requirePaddleBilling(getEnv);
      const authorization = request.headers.get('authorization');
      if (!authorization?.startsWith('Bearer ')) throw new BillingError('Sign in to continue', 401);
      const client = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: authorization } },
      });
      const { data: auth, error: authError } = await client.auth.getUser();
      if (authError || !auth.user) throw new BillingError('Sign in to continue', 401);
      requirePaddleTester(getEnv, auth.user.id);
      const body = await request.json();
      if (!/^[0-9a-f-]{36}$/i.test(body.vesselId || '')) throw new BillingError('Invalid vessel');
      const { data: billing, error } = await client.rpc('get_paddle_reactivation_billing', {
        p_vessel_id: body.vesselId,
        p_environment: environment,
      });
      if (
        error ||
        billing?.environment !== environment ||
        !/^sub_[a-z0-9]{26}$/.test(billing?.subscription_id || '') ||
        !/^ctm_[a-z0-9]{26}$/.test(billing?.customer_id || '')
      )
        throw new BillingError(
          'A confirmed expired subscription and Captain/MOV device access are required.',
          409
        );
      const config = paddleConfig(getEnv);
      const page = checkoutPage(getEnv);
      const old = await paddleRequest(
        config,
        `/subscriptions/${billing.subscription_id}`,
        {},
        fetcher
      );
      if (
        old.id !== billing.subscription_id ||
        old.customer_id !== billing.customer_id ||
        old.status !== 'canceled' ||
        old.collection_mode !== 'automatic' ||
        old.currency_code !== 'USD' ||
        !Number.isFinite(Date.parse(old.canceled_at)) ||
        Date.parse(old.canceled_at) > now()
      )
        throw new BillingError(
          'Paddle is still confirming the previous subscription. Refresh Plan Status before retrying.',
          409
        );
      const priceId = config.paidPrices?.[billing.plan_tier]?.[billing.billing_period];
      if (!priceId)
        throw new BillingError(
          'Paid reactivation is awaiting configuration. Please contact support.',
          503
        );
      const price = await paddleRequest(config, `/prices/${priceId}`, {}, fetcher);
      if (price.id !== priceId) throw new BillingError('Paid price could not be verified.', 503);
      validatePrice(price, billing.plan_tier, billing.billing_period, true);
      const { data: intent, error: reserveError } = await client.rpc(
        'reserve_paddle_reactivation',
        {
          p_vessel_id: body.vesselId,
          p_environment: environment,
          p_subscription_id: old.id,
          p_price_id: priceId,
        }
      );
      if (reserveError || !intent?.id)
        throw new BillingError('Refresh Plan Status before preparing payment again.', 409);
      let transaction;
      if (intent.state === 'ready' && /^txn_[a-z0-9]{26}$/.test(intent.transaction_id || '')) {
        transaction = await paddleRequest(
          config,
          `/transactions/${intent.transaction_id}`,
          {},
          fetcher
        );
      } else if (intent.state === 'creating' && intent.created === true) {
        transaction = await paddleRequest(
          config,
          '/transactions',
          {
            method: 'POST',
            body: JSON.stringify({
              collection_mode: 'automatic',
              currency_code: 'USD',
              customer_id: billing.customer_id,
              // Paddle checkout collects/validates the billing address and tax.
              items: [{ price_id: priceId, quantity: 1 }],
              custom_data: { checkout_id: intent.id },
              checkout: { url: page.href },
            }),
          },
          fetcher
        );
      } else {
        throw new BillingError(
          'Your previous payment request is being confirmed. Contact support before retrying.',
          409
        );
      }
      if (
        !['draft', 'ready'].includes(transaction.status) ||
        transaction.subscription_id != null ||
        transaction.customer_id !== billing.customer_id ||
        transaction.currency_code !== 'USD' ||
        transaction.collection_mode !== 'automatic' ||
        transaction.custom_data?.checkout_id !== intent.id ||
        transaction.items?.length !== 1 ||
        transaction.items[0].quantity !== 1 ||
        transaction.items[0].price?.id !== priceId ||
        (intent.state === 'ready' && transaction.id !== intent.transaction_id)
      )
        throw new BillingError(
          'Payment is being confirmed or its details changed. Refresh Plan Status.',
          409
        );
      validatePrice(transaction.items[0].price, billing.plan_tier, billing.billing_period, true);
      const result = checkoutResult(transaction, page, environment);
      if (intent.created) {
        const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
        const { data: saved, error: saveError } = await admin
          .from('paddle_checkout_intents')
          .update({ transaction_id: transaction.id, state: 'ready' })
          .eq('id', intent.id)
          .eq('state', 'creating')
          .select('id');
        if (saveError || saved?.length !== 1)
          throw new BillingError(
            'Payment request is awaiting confirmation. Contact support before retrying.',
            503
          );
      }
      return Response.json(
        { ...result, purpose: 'paid_reactivation' },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof BillingError
              ? error.message
              : 'Payment could not be prepared. Refresh Plan Status; contact support before retrying.',
        },
        {
          status: error instanceof BillingError ? error.status : 503,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }
  };
}
