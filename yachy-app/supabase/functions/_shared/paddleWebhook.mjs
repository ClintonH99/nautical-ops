import {
  BillingError,
  paddleConfig,
  paddleRequest,
  subscriptionEvent,
  verifyPaddleSignature,
} from './paddle.mjs';
import { previouslyPaid } from './paddlePaidHistory.mjs';

// Deploy with JWT verification disabled ONLY for this signed provider endpoint.
export function createPaddleWebhookHandler({ getEnv, createClient, fetcher = fetch }) {
  return async (request) => {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 262144) return new Response(null, { status: 413 });
      const environment = getEnv('PADDLE_ENV');
      // Keep the existing sandbox secret untouched at live cutover. Never
      // interpret a sandbox-signed event as live billing evidence.
      const signingSecret =
        environment === 'live'
          ? getEnv('PADDLE_LIVE_WEBHOOK_SECRET')
          : environment === 'sandbox'
            ? getEnv('PADDLE_WEBHOOK_SECRET')
            : undefined;
      if (
        !(await verifyPaddleSignature(raw, request.headers.get('Paddle-Signature'), signingSecret))
      )
        return new Response(null, { status: 401 });
      const config = paddleConfig(getEnv);
      const event = subscriptionEvent(JSON.parse(raw), config);
      if (!event) return Response.json({ ignored: true });
      // An active label or browser completion is not proof of the first paid
      // checkout. Verify the bound completed transaction before replacing the
      // expired entitlement. A provider delay returns retryable 503.
      if (event.no_trial_price && event.transaction_id) {
        if (!/^txn_[a-z0-9]{26}$/.test(event.transaction_id))
          throw new Error('Invalid transaction');
        const transaction = await paddleRequest(
          config,
          `/transactions/${event.transaction_id}`,
          {},
          fetcher
        );
        if (
          transaction.id !== event.transaction_id ||
          transaction.status !== 'completed' ||
          transaction.subscription_id !== event.subscription_id ||
          transaction.customer_id !== event.customer_id ||
          transaction.custom_data?.checkout_id !== event.checkout_id ||
          transaction.collection_mode !== 'automatic' ||
          transaction.currency_code !== 'USD' ||
          transaction.items?.length !== 1 ||
          transaction.items[0].quantity !== 1 ||
          transaction.items[0].price?.id !== event.price_id ||
          transaction.details?.totals?.balance !== '0'
        )
          throw new Error('Payment not confirmed');
        event.initial_payment_verified = true;
      }
      if (event.status === 'past_due') {
        event.previously_paid = await previouslyPaid(config, event, fetcher);
        event.paid_history_verified = true;
      }
      const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
      const { error } = await admin.rpc('apply_paddle_subscription_event', { p_event: event });
      // Do not acknowledge a failed database write: Paddle must retry it.
      if (error) return Response.json({ error: 'Subscription update pending' }, { status: 503 });
      return Response.json({ received: true });
    } catch (error) {
      return Response.json(
        { error: 'Unable to process billing event' },
        { status: error instanceof BillingError ? error.status : 503 }
      );
    }
  };
}
