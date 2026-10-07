import {
  BillingError,
  approvedPrice,
  paddleConfig,
  paddleRequest,
  validatePrice,
  checkoutPage,
  checkoutResult,
} from './paddle.mjs';

// An ambiguous provider timeout deliberately leaves the reservation pending.
// Reconciliation must locate that transaction before allowing another purchase.
export function createPaddleCheckoutHandler({ getEnv, createClient, fetcher = fetch }) {
  return async (request) => {
    if (request.method !== 'POST')
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    try {
      if (getEnv('PADDLE_CHECKOUT_ENABLED') !== 'true')
        throw new BillingError('Payments are not yet available', 503);
      const config = paddleConfig(getEnv);
      const page = checkoutPage(getEnv);
      const authorization = request.headers.get('authorization');
      if (!authorization?.startsWith('Bearer ')) throw new BillingError('Sign in to continue', 401);
      const scoped = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: authorization } },
      });
      const { data: auth, error: authError } = await scoped.auth.getUser();
      if (authError || !auth.user) throw new BillingError('Sign in to continue', 401);
      const body = await request.json();
      approvedPrice(body.planTier, body.billingPeriod);
      if (!/^[0-9a-f-]{36}$/i.test(body.vesselId || '')) throw new BillingError('Invalid vessel');
      const priceId = config.prices[body.planTier][body.billingPeriod];
      const price = await paddleRequest(config, `/prices/${priceId}`, {}, fetcher);
      validatePrice(price, body.planTier, body.billingPeriod);
      const { data: reservation, error } = await scoped.rpc('reserve_paddle_checkout', {
        p_vessel_id: body.vesselId,
        p_plan_tier: body.planTier,
        p_billing_period: body.billingPeriod,
        p_environment: config.environment,
        p_price_id: priceId,
      });
      if (error)
        throw new BillingError(
          'Only the vessel Captain/MOV can start a new plan. Check existing billing before trying again.',
          409
        );
      const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
      if (reservation.state === 'ready') {
        const transaction = await paddleRequest(
          config,
          `/transactions/${reservation.transaction_id}`,
          {},
          fetcher
        );
        if (!['draft', 'ready'].includes(transaction.status) || !transaction.checkout?.url)
          throw new BillingError(
            'This payment is already being processed. Please refresh your plan.',
            409
          );
        return Response.json(checkoutResult(transaction, page, config.environment));
      }
      if (!reservation.created)
        throw new BillingError(
          'Your previous checkout is being confirmed. Please contact support if this persists.',
          409
        );
      const transaction = await paddleRequest(
        config,
        '/transactions',
        {
          method: 'POST',
          body: JSON.stringify({
            collection_mode: 'automatic',
            items: [{ price_id: priceId, quantity: 1 }],
            custom_data: { checkout_id: reservation.id },
            checkout: { url: page.href },
          }),
        },
        fetcher
      );
      const result = checkoutResult(transaction, page, config.environment);
      const { data: saved, error: saveError } = await admin
        .from('paddle_checkout_intents')
        .update({
          transaction_id: transaction.id,
          state: 'ready',
        })
        .eq('id', reservation.id)
        .eq('state', 'creating')
        .select('id');
      if (saveError || saved?.length !== 1)
        throw new BillingError(
          'Checkout could not be confirmed. Please contact support before retrying.',
          503
        );
      return Response.json(result);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof BillingError
              ? error.message
              : 'Unable to prepare payment. Please try again later.',
        },
        { status: error instanceof BillingError ? error.status : 503 }
      );
    }
  };
}
