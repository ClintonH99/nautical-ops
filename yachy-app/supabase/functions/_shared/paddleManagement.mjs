import {
  BillingError,
  paddleConfig,
  paddleRequest,
  checkoutPage,
  checkoutResult,
} from './paddle.mjs';
import { requirePaddleBilling, requirePaddleTester } from './paddleRollout.mjs';

// No customer-wide portal sessions, new subscriptions, charges, price changes or
// entitlement writes. Cancellation is always at the confirmed period end.
export function createPaddleManagementHandler({
  getEnv,
  createClient,
  fetcher = fetch,
  now = Date.now,
}) {
  return async (request) => {
    const headers = { 'Cache-Control': 'no-store' };
    if (request.method !== 'POST') return new Response(null, { status: 405, headers });
    try {
      const environment = requirePaddleBilling(getEnv);
      if (getEnv('PADDLE_SUBSCRIPTION_MANAGEMENT_ENABLED') !== 'true')
        throw new BillingError('Subscription management is not enabled.', 503);
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
      if (
        !['status', 'payment_method', 'cancel_renewal', 'keep_subscription'].includes(body.action)
      )
        throw new BillingError('Unsupported subscription action');
      const { data: billing, error } = await client.rpc('get_paddle_management_billing', {
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
          'A confirmed subscription and Captain/MOV device access are required.',
          409
        );
      const config = paddleConfig(getEnv);
      const path = `/subscriptions/${billing.subscription_id}`;
      const subscription = await paddleRequest(config, path, {}, fetcher);
      const end = Date.parse(subscription.current_billing_period?.ends_at);
      if (
        subscription.id !== billing.subscription_id ||
        subscription.customer_id !== billing.customer_id ||
        subscription.collection_mode !== 'automatic' ||
        subscription.currency_code !== 'USD' ||
        !['active', 'trialing', 'past_due'].includes(subscription.status) ||
        !Number.isFinite(end) ||
        end !== Date.parse(billing.period_end) ||
        subscription.items?.length !== 1 ||
        subscription.items[0].quantity !== 1 ||
        subscription.items[0].price?.id !==
          config.prices[billing.plan_tier]?.[billing.billing_period]
      )
        throw new BillingError(
          'Subscription details have changed. Refresh Plan Status before continuing.',
          409
        );
      const scheduled = subscription.scheduled_change;
      if (
        scheduled != null &&
        (scheduled.action !== 'cancel' || Date.parse(scheduled.effective_at) !== end)
      )
        throw new BillingError('A different subscription change is pending. Contact support.', 409);
      if (body.action === 'status')
        return Response.json(
          {
            environment,
            status: subscription.status,
            periodEnd: new Date(end).toISOString(),
            cancellationScheduled: scheduled?.action === 'cancel',
          },
          { headers }
        );
      if (body.action === 'keep_subscription') {
        if (
          body.confirm !== true ||
          Date.parse(body.periodEnd) !== end ||
          end <= now() ||
          !['active', 'trialing'].includes(subscription.status)
        )
          throw new BillingError(
            'Review the current renewal date and subscription status first.',
            409
          );
        if (scheduled?.action === 'cancel') {
          // Remove only the future cancellation. Do not change items, dates,
          // payment methods or activate a trial. Reconcile ambiguous failures
          // with a fresh read; never automatically retry a billing mutation.
          const updated = await paddleRequest(
            config,
            path,
            { method: 'PATCH', body: JSON.stringify({ scheduled_change: null }) },
            fetcher
          );
          if (
            updated.id !== subscription.id ||
            updated.customer_id !== subscription.customer_id ||
            updated.status !== subscription.status ||
            updated.collection_mode !== subscription.collection_mode ||
            updated.currency_code !== subscription.currency_code ||
            Date.parse(updated.current_billing_period?.ends_at) !== end ||
            Date.parse(updated.next_billed_at) !== end ||
            updated.scheduled_change !== null ||
            updated.items?.length !== 1 ||
            updated.items[0].quantity !== 1 ||
            updated.items[0].price?.id !== subscription.items[0].price.id
          )
            throw new BillingError(
              'Renewal is awaiting confirmation. Refresh Plan Status before retrying.',
              503
            );
        }
        return Response.json(
          { environment, state: 'pending_confirmation', periodEnd: new Date(end).toISOString() },
          { headers }
        );
      }
      if (body.action === 'cancel_renewal') {
        if (body.confirm !== true || Date.parse(body.periodEnd) !== end || end <= now())
          throw new BillingError('Review and confirm the current cancellation date first.', 409);
        if (scheduled?.action !== 'cancel') {
          // No automatic retries on timeouts. Read status again to reconcile.
          const updated = await paddleRequest(
            config,
            `${path}/cancel`,
            {
              method: 'POST',
              body: JSON.stringify({ effective_from: 'next_billing_period' }),
            },
            fetcher
          );
          if (
            updated.id !== billing.subscription_id ||
            updated.customer_id !== billing.customer_id ||
            updated.status !== subscription.status ||
            Date.parse(updated.current_billing_period?.ends_at) !== end ||
            updated.scheduled_change?.action !== 'cancel' ||
            Date.parse(updated.scheduled_change.effective_at) !== end
          )
            throw new BillingError(
              'Cancellation is awaiting confirmation. Refresh Plan Status before retrying.',
              503
            );
        }
        return Response.json(
          {
            environment,
            state: 'pending_confirmation',
            periodEnd: new Date(end).toISOString(),
          },
          { headers }
        );
      }
      // Trial setup keeps its dedicated date-checked path; overdue payments use
      // recovery. Never present an outstanding balance as a free card update.
      if (subscription.status !== 'active' || scheduled != null || end <= now())
        throw new BillingError(
          'Use the trial setup or payment recovery action for this subscription.',
          409
        );
      const transaction = await paddleRequest(
        config,
        `${path}/update-payment-method-transaction`,
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
          ...checkoutResult(transaction, checkoutPage(getEnv), environment),
          purpose: 'payment_method',
        },
        { headers }
      );
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof BillingError
              ? error.message
              : 'Subscription action could not be confirmed. Refresh Plan Status before retrying.',
        },
        { status: error instanceof BillingError ? error.status : 503, headers }
      );
    }
  };
}
