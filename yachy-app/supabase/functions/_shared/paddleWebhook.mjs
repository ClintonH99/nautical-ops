import { BillingError, paddleConfig, subscriptionEvent, verifyPaddleSignature } from './paddle.mjs';

// Deploy with JWT verification disabled ONLY for this signed provider endpoint.
export function createPaddleWebhookHandler({ getEnv, createClient }) {
  return async (request) => {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 262144) return new Response(null, { status: 413 });
      if (
        !(await verifyPaddleSignature(
          raw,
          request.headers.get('Paddle-Signature'),
          getEnv('PADDLE_WEBHOOK_SECRET')
        ))
      )
        return new Response(null, { status: 401 });
      const config = paddleConfig(getEnv);
      const event = subscriptionEvent(JSON.parse(raw), config);
      if (!event) return Response.json({ ignored: true });
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
