import { verifyPaddleSignature } from './paddle.mjs';
import { createPaddleWebhookHandler } from './paddleWebhook.mjs';

// Separate URL and replacement secret: never reuse either legacy webhook secret.
// Processing requires a later explicit activation; verification probes cannot
// create a database client, make provider requests, or grant vessel access.
export function createPaddleLiveWebhookHandler({ getEnv, createClient, fetcher = fetch }) {
  return async (request) => {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 262144)
        return new Response(null, { status: 413 });
      const secret = getEnv('PADDLE_LIVE_WEBHOOK_V2_SECRET');
      if (!secret) return Response.json({ error: 'Webhook not configured' }, { status: 503 });
      if (!(await verifyPaddleSignature(raw, request.headers.get('Paddle-Signature'), secret)))
        return new Response(null, { status: 401 });

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return Response.json({ error: 'Invalid event' }, { status: 400 });
      }
      if (!payload || typeof payload !== 'object' || typeof payload.event_type !== 'string')
        return Response.json({ error: 'Invalid event' }, { status: 400 });

      const enabled =
        getEnv('PADDLE_LIVE_WEBHOOK_PROCESSING_ENABLED') === 'true' &&
        getEnv('PADDLE_LIVE_BILLING_ENABLED') === 'true' &&
        getEnv('PADDLE_ENV') === 'live';
      if (!enabled) {
        // Existing fulfillment is subscription-event based. Use only this
        // ignored event for the official Paddle simulator connectivity check.
        if (payload.event_type === 'transaction.completed')
          return Response.json({ verified: true, ignored: true, mode: 'verification-only' });
        // Never acknowledge and discard a real subscription update while gated.
        return Response.json({ error: 'Live webhook processing disabled' }, { status: 503 });
      }

      const scopedEnv = (key) =>
        key === 'PADDLE_LIVE_WEBHOOK_SECRET' ? secret : getEnv(key);
      return await createPaddleWebhookHandler({ getEnv: scopedEnv, createClient, fetcher })(
        new Request(request.url, { method: 'POST', headers: request.headers, body: raw })
      );
    } catch {
      return Response.json({ error: 'Unable to process billing event' }, { status: 503 });
    }
  };
}
