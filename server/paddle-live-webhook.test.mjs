import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createPaddleLiveWebhookHandler } from '../yachy-app/supabase/functions/_shared/paddleLiveWebhook.mjs';

const replacement = 'synthetic-replacement-secret';
const id = (prefix, n) => `${prefix}_${String(n).padStart(26, '0')}`;
const prices = Object.fromEntries(['1_5', '6_10', '11_15', '16_25', '26_40', '40_plus'].map(
  (tier, i) => [tier, Object.fromEntries(['monthly', '3_months', '6_months', '12_months'].map(
    (period, j) => [period, id('pri', i * 4 + j)]
  ))]
));
const subscription = {
  event_type: 'subscription.created', event_id: id('evt', 1), occurred_at: '2026-10-29T12:00:00Z',
  data: {
    id: id('sub', 1), customer_id: id('ctm', 1), status: 'trialing', collection_mode: 'automatic',
    items: [{ quantity: 1, price: { id: prices['1_5'].monthly } }],
    current_billing_period: { starts_at: '2026-10-29T12:00:00Z', ends_at: '2026-11-28T12:00:00Z' },
  },
};
function request(payload = { event_type: 'transaction.completed' }, secret = replacement, age = 0) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000) - age;
  const signature = createHmac('sha256', secret).update(`${ts}:${raw}`).digest('hex');
  return new Request('https://local.invalid/paddle-live-webhook', {
    method: 'POST', body: raw, headers: { 'Paddle-Signature': `ts=${ts};h1=${signature}` },
  });
}
function harness(overrides = {}, dbError = false) {
  const calls = { clients: 0, rpc: [], fetches: 0 };
  const env = {
    PADDLE_ENV: 'sandbox', PADDLE_LIVE_WEBHOOK_V2_SECRET: replacement,
    PADDLE_WEBHOOK_SECRET: 'synthetic-sandbox', PADDLE_LIVE_WEBHOOK_SECRET: 'synthetic-old-live',
    PADDLE_LIVE_PRICE_IDS: JSON.stringify(prices), PADDLE_LIVE_API_KEY: 'synthetic-api',
    SUPABASE_URL: 'https://local.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
    ...overrides,
  };
  const handler = createPaddleLiveWebhookHandler({
    getEnv: key => env[key],
    createClient: () => {
      calls.clients++;
      return { rpc: async (name, args) => {
        calls.rpc.push({ name, args });
        return { error: dbError ? { message: 'private internal details' } : null };
      } };
    },
    fetcher: async () => { calls.fetches++; throw new Error('No external requests allowed in tests'); },
  });
  return { handler, calls };
}
function untouched(calls) { assert.deepEqual(calls, { clients: 0, rpc: [], fetches: 0 }); }
const enabled = { PADDLE_ENV: 'live', PADDLE_LIVE_BILLING_ENABLED: 'true', PADDLE_LIVE_WEBHOOK_PROCESSING_ENABLED: 'true' };

test('replacement endpoint rejects missing secret without legacy fallback', async () => {
  const h = harness({ PADDLE_LIVE_WEBHOOK_V2_SECRET: undefined });
  assert.equal((await h.handler(request())).status, 503); untouched(h.calls);
});
test('old live, sandbox and forged signatures are rejected', async () => {
  for (const secret of ['synthetic-old-live', 'synthetic-sandbox', 'forged']) {
    const h = harness(); assert.equal((await h.handler(request(undefined, secret))).status, 401); untouched(h.calls);
  }
});
test('expired, missing and tampered signatures are rejected', async () => {
  const h = harness();
  assert.equal((await h.handler(request(undefined, replacement, 301))).status, 401);
  assert.equal((await h.handler(new Request('https://local.invalid', { method: 'POST', body: '{}' }))).status, 401);
  const signed = request();
  assert.equal((await h.handler(new Request(signed.url, { method: 'POST', headers: signed.headers, body: '{"event_type":"subscription.created"}' }))).status, 401);
  untouched(h.calls);
});
test('signed diagnostic is verification-only without provider or database access', async () => {
  const h = harness(); const result = await h.handler(request());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { verified: true, ignored: true, mode: 'verification-only' }); untouched(h.calls);
});
test('subscription updates fail retryably while any activation gate is absent', async () => {
  for (const overrides of [{}, { ...enabled, PADDLE_ENV: 'sandbox' }, { ...enabled, PADDLE_LIVE_BILLING_ENABLED: 'false' }, { ...enabled, PADDLE_LIVE_WEBHOOK_PROCESSING_ENABLED: undefined }, { ...enabled, PADDLE_LIVE_WEBHOOK_PROCESSING_ENABLED: 'TRUE' }]) {
    const h = harness(overrides); assert.equal((await h.handler(request(subscription))).status, 503); untouched(h.calls);
  }
});
test('signed invalid JSON and invalid event shapes cannot reach services', async () => {
  for (const value of ['{', 'null', '[]', '{}']) {
    const h = harness(enabled); assert.equal((await h.handler(request(value))).status, 400); untouched(h.calls);
  }
});
test('methods and oversized bodies are rejected before service access', async () => {
  const h = harness();
  assert.equal((await h.handler(new Request('https://local.invalid'))).status, 405);
  assert.equal((await h.handler(request('x'.repeat(262145)))).status, 413); untouched(h.calls);
});
test('explicit future activation delegates only verified live events to existing RPC', async () => {
  const h = harness(enabled); assert.equal((await h.handler(request(subscription))).status, 200);
  assert.equal(h.calls.clients, 1); assert.equal(h.calls.fetches, 0); assert.equal(h.calls.rpc.length, 1);
  assert.equal(h.calls.rpc[0].name, 'apply_paddle_subscription_event');
  assert.equal(h.calls.rpc[0].args.p_event.environment, 'live');
});
test('future activated processing still rejects unknown catalogue IDs', async () => {
  const h = harness(enabled); const payload = structuredClone(subscription);
  payload.data.items[0].price.id = id('pri', 100);
  assert.equal((await h.handler(request(payload))).status, 422); untouched(h.calls);
});
test('future activated database errors stay retryable and never reveal internals', async () => {
  const h = harness(enabled, true); const result = await h.handler(request(subscription));
  assert.equal(result.status, 503); assert.doesNotMatch(await result.text(), /private internal/);
});
