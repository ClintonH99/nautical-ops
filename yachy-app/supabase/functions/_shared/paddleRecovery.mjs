import {
  BillingError,
  paddleConfig,
  paddleRequest,
  checkoutPage,
  checkoutResult,
} from './paddle.mjs';
import {
  requirePaddleBilling,
  requirePaddleTester,
  billingEnvironmentArgs,
} from './paddleRollout.mjs';

// Fetch the EXISTING overdue transaction behind environment-specific gates. No new subscription,
// early activation, entitlement writes, or automatic payment collection.
export function createPaddleRecoveryHandler({ getEnv, createClient, fetcher = fetch }) {
  return async (request) => {
    const headers = { 'Cache-Control': 'no-store' };
    if (request.method !== 'POST') return new Response(null, { status: 405, headers });
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
      // SQL checks Captain role, vessel membership AND device access, even while
      // payment-restricted. Never accept provider IDs supplied by the browser.
      const { data: billing, error } = await client.rpc('get_paddle_recovery_billing', {
        p_vessel_id: body.vesselId,
        ...billingEnvironmentArgs(environment),
      });
      if (
        error ||
        billing?.environment !== environment ||
        !/^sub_[a-z0-9]{26}$/.test(billing?.subscription_id || '') ||
        !/^ctm_[a-z0-9]{26}$/.test(billing?.customer_id || '')
      )
        throw new BillingError(
          'A past-due subscription and Captain/MOV device access are required.',
          409
        );
      const config = paddleConfig(getEnv);
      const subscription = await paddleRequest(
        config,
        `/subscriptions/${billing.subscription_id}`,
        {},
        fetcher
      );
      if (
        subscription.id !== billing.subscription_id ||
        subscription.customer_id !== billing.customer_id ||
        subscription.status !== 'past_due' ||
        subscription.collection_mode !== 'automatic'
      )
        throw new BillingError(
          'Billing status has changed. Refresh Plan Status before retrying.',
          409
        );
      const transaction = await paddleRequest(
        config,
        `/subscriptions/${billing.subscription_id}/update-payment-method-transaction`,
        {},
        fetcher
      );
      if (
        transaction.subscription_id !== billing.subscription_id ||
        transaction.customer_id !== billing.customer_id ||
        transaction.status !== 'past_due' ||
        transaction.collection_mode !== 'automatic' ||
        transaction.currency_code !== 'USD' ||
        !/^[1-9]\d*$/.test(transaction.details?.totals?.balance)
      )
        throw new BillingError(
          'The outstanding payment could not be verified. Refresh Plan Status.',
          409
        );
      return Response.json(
        {
          ...checkoutResult(transaction, checkoutPage(getEnv), config.environment),
          purpose: 'payment_recovery',
        },
        { headers }
      );
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof BillingError
              ? error.message
              : 'Payment recovery could not be confirmed. Refresh Plan Status before retrying.',
        },
        { status: error instanceof BillingError ? error.status : 503, headers }
      );
    }
  };
}
