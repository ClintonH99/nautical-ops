import {
  BillingError,
  paddleConfig,
  paddleRequest,
  checkoutPage,
  checkoutResult,
  validatePrice,
} from './paddle.mjs';

// Collect a card for an EXISTING trial. Never activate, replace or extend it.
export function createPaddleTrialPaymentHandler({
  getEnv,
  createClient,
  fetcher = fetch,
  now = Date.now,
}) {
  return async (request) => {
    if (request.method !== 'POST')
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    try {
      if (getEnv('PADDLE_ENV') !== 'sandbox' || getEnv('PADDLE_SANDBOX_TRIAL_ENABLED') !== 'true')
        throw new BillingError('Sandbox trials are not enabled.', 503);
      const authorization = request.headers.get('authorization');
      if (!authorization?.startsWith('Bearer ')) throw new BillingError('Sign in to continue', 401);
      const client = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: authorization } },
      });
      const { data: auth, error: authError } = await client.auth.getUser();
      if (authError || !auth.user) throw new BillingError('Sign in to continue', 401);
      const testers = (getEnv('PADDLE_SANDBOX_TEST_USER_IDS') || '')
        .split(',')
        .map((id) => id.trim());
      if (!testers.includes(auth.user.id))
        throw new BillingError('Sandbox testing is restricted.', 403);
      const body = await request.json();
      if (!/^[0-9a-f-]{36}$/i.test(body.vesselId || '')) throw new BillingError('Invalid vessel');
      const { data: billing, error } = await client.rpc('get_paddle_trial_billing', {
        p_vessel_id: body.vesselId,
      });
      if (
        error ||
        billing?.environment !== 'sandbox' ||
        !/^sub_[a-z0-9]{26}$/.test(billing.subscription_id || '') ||
        !/^ctm_[a-z0-9]{26}$/.test(billing.customer_id || '')
      )
        throw new BillingError(
          'A confirmed trial and Captain/MOV device access are required.',
          409
        );
      const config = paddleConfig(getEnv);
      const page = checkoutPage(getEnv);
      const subscription = await paddleRequest(
        config,
        `/subscriptions/${billing.subscription_id}`,
        {},
        fetcher
      );
      const item = subscription.items?.[0];
      const end = Date.parse(subscription.current_billing_period?.ends_at);
      if (
        subscription.id !== billing.subscription_id ||
        subscription.customer_id !== billing.customer_id ||
        subscription.status !== 'trialing' ||
        subscription.collection_mode !== 'automatic' ||
        subscription.scheduled_change != null ||
        subscription.items?.length !== 1 ||
        item.quantity !== 1 ||
        item.price?.id !== config.prices[billing.plan_tier]?.[billing.billing_period] ||
        !Number.isFinite(end) ||
        end <= now() ||
        end !== Date.parse(billing.trial_end)
      )
        throw new BillingError(
          'The trial has changed. Refresh your plan before adding payment details.',
          409
        );
      validatePrice(item.price, billing.plan_tier, billing.billing_period);
      const transaction = await paddleRequest(
        config,
        `/subscriptions/${billing.subscription_id}/update-payment-method-transaction`,
        {},
        fetcher
      );
      if (
        transaction.subscription_id !== billing.subscription_id ||
        transaction.customer_id !== billing.customer_id ||
        transaction.origin !== 'subscription_payment_method_change' ||
        transaction.status !== 'ready' ||
        transaction.collection_mode !== 'automatic' ||
        transaction.currency_code !== 'USD' ||
        transaction.details?.totals?.currency_code !== 'USD' ||
        !['total', 'grand_total', 'balance'].every((key) => transaction.details.totals[key] === '0')
      )
        throw new BillingError('Payment setup could not be verified as a zero-charge update.', 502);
      return Response.json(
        {
          ...checkoutResult(transaction, page, config.environment),
          purpose: 'trial_payment_method',
          trialEnd: new Date(end).toISOString(),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof BillingError
              ? error.message
              : 'Payment setup could not be confirmed. Refresh your plan before retrying.',
        },
        {
          status: error instanceof BillingError ? error.status : 503,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }
  };
}
