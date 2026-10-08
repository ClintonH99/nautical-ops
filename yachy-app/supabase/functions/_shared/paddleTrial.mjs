import {
  BillingError,
  approvedPrice,
  paddleConfig,
  paddleRequest,
  validatePrice,
} from './paddle.mjs';
import { billingLocation } from './paddlePricing.mjs';

// Deliberately sandbox-only until the complete billing lifecycle is verified.
// No browser success event, provider API response or local clock grants access.
export function createPaddleTrialHandler({ getEnv, createClient, fetcher = fetch }) {
  return async (request) => {
    if (request.method !== 'POST')
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    try {
      if (getEnv('PADDLE_ENV') !== 'sandbox' || getEnv('PADDLE_SANDBOX_TRIAL_ENABLED') !== 'true')
        throw new BillingError('Sandbox trials are not enabled.', 503);
      const authorization = request.headers.get('authorization');
      if (!authorization?.startsWith('Bearer ')) throw new BillingError('Sign in to continue', 401);
      const scoped = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: authorization } },
      });
      const { data: auth, error: authError } = await scoped.auth.getUser();
      if (authError || !auth.user?.email) throw new BillingError('Sign in to continue', 401);
      const testers = (getEnv('PADDLE_SANDBOX_TEST_USER_IDS') || '')
        .split(',')
        .map((id) => id.trim());
      if (!testers.includes(auth.user.id))
        throw new BillingError('Sandbox testing is restricted.', 403);
      const body = await request.json();
      if (!/^[0-9a-f-]{36}$/i.test(body.vesselId || '')) throw new BillingError('Invalid vessel');
      approvedPrice(body.planTier, body.billingPeriod);
      const address = billingLocation(body);
      const config = paddleConfig(getEnv);
      const priceId = config.prices[body.planTier][body.billingPeriod];
      const price = await paddleRequest(config, `/prices/${priceId}`, {}, fetcher);
      validatePrice(price, body.planTier, body.billingPeriod);
      if (price.trial_period?.requires_payment_method !== false)
        throw new BillingError('This price is not a cardless trial.', 503);
      const { data: intent, error } = await scoped.rpc('reserve_paddle_trial', {
        p_vessel_id: body.vesselId,
        p_plan_tier: body.planTier,
        p_billing_period: body.billingPeriod,
        p_price_id: priceId,
      });
      if (error || !intent?.id)
        throw new BillingError(
          'Trial could not be reserved. Check membership, device access and existing billing.',
          409
        );
      let transaction;
      if (!intent.created) {
        if (intent.state !== 'ready' || !/^txn_[a-z0-9]{26}$/.test(intent.transaction_id || ''))
          throw new BillingError(
            'Your previous trial request is being confirmed. Contact support before retrying.',
            409
          );
        transaction = await paddleRequest(
          config,
          `/transactions/${intent.transaction_id}`,
          {},
          fetcher
        );
      } else {
        // Customer/address creation has no billing side effect. An ambiguous
        // timeout leaves the reservation blocked for reconciliation, not retry.
        const customers = await paddleRequest(
          config,
          `/customers?email=${encodeURIComponent(auth.user.email)}&status=active`,
          {},
          fetcher
        );
        if (
          !Array.isArray(customers) ||
          customers.length > 1 ||
          customers.some((customer) => customer.email !== auth.user.email)
        )
          throw new BillingError('Customer could not be confirmed', 502);
        const customer =
          customers[0] ||
          (await paddleRequest(
            config,
            '/customers',
            {
              method: 'POST',
              body: JSON.stringify({ email: auth.user.email }),
            },
            fetcher
          ));
        if (!/^ctm_[a-z0-9]{26}$/.test(customer.id || ''))
          throw new BillingError('Customer could not be confirmed', 502);
        const billingAddress = await paddleRequest(
          config,
          `/customers/${customer.id}/addresses`,
          {
            method: 'POST',
            body: JSON.stringify(address),
          },
          fetcher
        );
        if (!/^add_[a-z0-9]{26}$/.test(billingAddress.id || ''))
          throw new BillingError('Address could not be confirmed', 502);
        transaction = await paddleRequest(
          config,
          '/transactions',
          {
            method: 'POST',
            body: JSON.stringify({
              customer_id: customer.id,
              address_id: billingAddress.id,
              currency_code: 'USD',
              collection_mode: 'automatic',
              items: [{ price_id: priceId, quantity: 1 }],
              custom_data: { checkout_id: intent.id },
            }),
          },
          fetcher
        );
        verifyTrialTransaction(transaction, priceId, intent.id, body);
        if (transaction.status !== 'ready')
          throw new BillingError('Trial transaction is not ready', 502);
        // Persist binding BEFORE billing: subscription.created can arrive as soon
        // as the PATCH is processed. Its signed webhook alone grants entitlement.
        const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
        const { data: saved, error: saveError } = await admin
          .from('paddle_checkout_intents')
          .update({ transaction_id: transaction.id, state: 'ready' })
          .eq('id', intent.id)
          .eq('state', 'creating')
          .select('id');
        if (saveError || saved?.length !== 1)
          throw new BillingError(
            'Trial binding could not be saved. Contact support before retrying.',
            503
          );
      }
      verifyTrialTransaction(transaction, priceId, intent.id, body);
      if (transaction.status === 'ready') {
        await paddleRequest(
          config,
          `/transactions/${transaction.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ status: 'billed' }),
          },
          fetcher
        );
      } else if (!['billed', 'paid', 'completed'].includes(transaction.status)) {
        throw new BillingError('This trial request cannot be completed. Contact support.', 409);
      }
      return Response.json(
        { state: 'pending_confirmation', environment: 'sandbox' },
        {
          status: 202,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof BillingError
              ? error.message
              : 'Trial could not be confirmed. Refresh your plan before retrying.',
        },
        {
          status: error instanceof BillingError ? error.status : 503,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }
  };
}

function verifyTrialTransaction(transaction, priceId, intentId, body) {
  const item = transaction?.items?.[0];
  if (
    !/^txn_[a-z0-9]{26}$/.test(transaction?.id || '') ||
    transaction.custom_data?.checkout_id !== intentId ||
    transaction.currency_code !== 'USD' ||
    transaction.collection_mode !== 'automatic' ||
    transaction.items?.length !== 1 ||
    item.quantity !== 1 ||
    item.price?.id !== priceId ||
    transaction.discount_id != null ||
    item.price.trial_period?.requires_payment_method !== false ||
    transaction.details?.totals?.currency_code !== 'USD' ||
    !['total', 'grand_total', 'balance'].every((key) => transaction.details.totals[key] === '0')
  )
    throw new BillingError('Trial transaction does not match the requested plan', 502);
  validatePrice(item.price, body.planTier, body.billingPeriod);
}
