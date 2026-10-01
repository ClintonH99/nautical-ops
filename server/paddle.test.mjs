import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createPaddleCheckoutHandler } from "../yachy-app/supabase/functions/_shared/paddleCheckout.mjs";
import { createPaddleWebhookHandler } from "../yachy-app/supabase/functions/_shared/paddleWebhook.mjs";
import {
  approvedPrice,
  paddleConfig,
  validatePrice,
  planForPrice,
  verifyPaddleSignature,
  subscriptionEvent,
  paddleRequest,
} from "../yachy-app/supabase/functions/_shared/paddle.mjs";
const id = (prefix, n) => `${prefix}_${String(n).padStart(26, "0")}`;
const tiers = ["1_5", "6_10", "11_15", "16_25", "26_40", "40_plus"];
const periods = ["monthly", "3_months", "6_months", "12_months"];
const prices = Object.fromEntries(
  tiers.map((tier, i) => [
    tier,
    Object.fromEntries(
      periods.map((period, j) => [period, id("pri", i * 4 + j)]),
    ),
  ]),
);
const config = { environment: "sandbox", prices };
test("all 24 server prices match the approved exact totals", () => {
  const expected = [
    [7999, 22797, 44154, 86389],
    [8999, 25647, 49674, 97189],
    [11999, 34197, 66234, 129589],
    [14999, 42747, 82794, 161989],
    [19999, 56997, 110394, 215989],
    [24999, 71247, 137994, 269989],
  ];
  tiers.forEach((tier, i) =>
    periods.forEach((period, j) => {
      assert.equal(approvedPrice(tier, period).amount, String(expected[i][j]));
      assert.deepEqual(planForPrice(prices, prices[tier][period]), {
        tier,
        period,
      });
    }),
  );
  assert.throws(() => approvedPrice("__proto__", "monthly"));
  assert.throws(() => approvedPrice("1_5", "weekly"));
  assert.throws(() => planForPrice(prices, "unknown"));
});
test("configuration requires explicit environment, separate keys and 24 unique IDs", () => {
  const env = {
    PADDLE_ENV: "sandbox",
    PADDLE_LIVE_API_KEY: "live-secret",
    PADDLE_PRICE_IDS: JSON.stringify(prices),
  };
  assert.throws(() => paddleConfig((key) => env[key]));
  env.PADDLE_SANDBOX_API_KEY = "sandbox-secret";
  assert.equal(paddleConfig((key) => env[key]).apiKey, "sandbox-secret");
  env.PADDLE_ENV = "production";
  assert.throws(() => paddleConfig((key) => env[key]));
  env.PADDLE_ENV = "live";
  env.PADDLE_PRICE_IDS = "{}";
  assert.throws(() => paddleConfig((key) => env[key]));
});
test("catalogue validation rejects wrong amounts, currencies, cycles, trials and quantity", () => {
  const price = {
    status: "active",
    unit_price: { amount: "86389", currency_code: "USD" },
    billing_cycle: { interval: "year", frequency: 1 },
    trial_period: null,
    quantity: { minimum: 1, maximum: 1 },
  };
  assert.doesNotThrow(() => validatePrice(price, "1_5", "12_months"));
  for (const patch of [
    { status: "archived" },
    { unit_price: { amount: "1", currency_code: "USD" } },
    { unit_price: { amount: "86389", currency_code: "EUR" } },
    { billing_cycle: { interval: "month", frequency: 1 } },
    { trial_period: { frequency: 1 } },
    { quantity: { minimum: 1, maximum: 999 } },
    { unit_price_overrides: [{}] },
  ]) {
    assert.throws(() =>
      validatePrice({ ...price, ...patch }, "1_5", "12_months"),
    );
  }
});
test("webhook HMAC verifies the original body, timestamp and rotating signatures", async () => {
  const now = 1800000000000;
  const ts = now / 1000;
  const raw = '{"a":1}';
  const sign = (body) =>
    createHmac("sha256", "secret").update(`${ts}:${body}`).digest("hex");
  const header = `ts=${ts};h1=${"0".repeat(64)};h1=${sign(raw)}`;
  assert.equal(await verifyPaddleSignature(raw, header, "secret", now), true);
  assert.equal(
    await verifyPaddleSignature('{ "a":1}', header, "secret", now),
    false,
  );
  assert.equal(
    await verifyPaddleSignature(raw, header, "secret", now + 301000),
    false,
  );
  assert.equal(await verifyPaddleSignature(raw, header, "wrong", now), false);
  assert.equal(
    await verifyPaddleSignature(raw, `${header};ts=${ts}`, "secret", now),
    false,
  );
});
const event = () => ({
  event_id: id("evt", 1),
  event_type: "subscription.created",
  occurred_at: "2026-10-02T00:00:00Z",
  data: {
    id: id("sub", 1),
    customer_id: id("ctm", 1),
    status: "active",
    collection_mode: "automatic",
    items: [{ quantity: 1, price: { id: prices["1_5"].monthly } }],
    current_billing_period: {
      starts_at: "2026-10-02T00:00:00Z",
      ends_at: "2026-11-02T00:00:00Z",
    },
    transaction_id: id("txn", 1),
    custom_data: { checkout_id: "00000000-0000-0000-0000-000000000001" },
  },
});
test("subscription parser uses catalogue identity and preserves scheduled cancellation", () => {
  const e = event();
  e.data.scheduled_change = {
    action: "cancel",
    effective_at: "2026-11-02T00:00:00Z",
  };
  const result = subscriptionEvent(e, config);
  assert.equal(result.plan_tier, "1_5");
  assert.equal(result.cancel_at, "2026-11-02T00:00:00Z");
  assert.equal(result.transaction_id, id("txn", 1));
  e.event_type = "subscription.updated";
  assert.equal(subscriptionEvent(e, config).transaction_id, null);
  e.data.items[0].quantity = 2;
  assert.throws(() => subscriptionEvent(e, config));
  e.event_type = "transaction.completed";
  assert.equal(subscriptionEvent(e, config), null);
});
test("active events cannot invent billing dates or use unknown prices; paused can have no period", () => {
  const e = event();
  e.data.current_billing_period = null;
  assert.throws(() => subscriptionEvent(e, config));
  e.data.status = "paused";
  assert.equal(subscriptionEvent(e, config).period_end, null);
  e.data.items[0].price.id = "bad";
  assert.throws(() => subscriptionEvent(e, config));
});
test("provider failures are not exposed as secrets or acknowledged as successful", async () => {
  await assert.rejects(
    paddleRequest(
      { base: "https://example.com", apiKey: "secret" },
      "/prices",
      {},
      async () => new Response("private detail", { status: 500 }),
    ),
    /temporarily unavailable/,
  );
  await assert.rejects(
    paddleRequest(
      { base: "https://example.com", apiKey: "secret" },
      "/prices",
      {},
      async () => Response.json({}),
    ),
    /Incomplete/,
  );
});
function harness(options = {}) {
  const calls = { purchases: 0, writes: 0, reservations: 0, applied: 0 };
  const env = {
    PADDLE_ENV: "sandbox",
    PADDLE_SANDBOX_API_KEY: "test-secret",
    PADDLE_PRICE_IDS: JSON.stringify(prices),
    PADDLE_CHECKOUT_ENABLED: "true",
    PADDLE_WEBHOOK_SECRET: "secret",
    ...options.env,
  };
  const deps = {
    getEnv: (key) => env[key],
    createClient: () => ({
      auth: {
        getUser: async () => ({
          data: { user: options.authError ? null : { id: "captain" } },
          error: options.authError,
        }),
      },
      rpc: async (name) => {
        if (name === "apply_paddle_subscription_event") {
          calls.applied++;
          return { error: options.databaseError };
        }
        calls.reservations++;
        return {
          error: options.denied,
          data: options.reservation || {
            id: "checkout",
            state: "creating",
            created: true,
          },
        };
      },
      from: () => ({
        update: () => {
          calls.writes++;
          return {
            eq: () => ({
              eq: () => ({
                select: async () => ({
                  error: options.databaseError,
                  data: [{ id: "checkout" }],
                }),
              }),
            }),
          };
        },
      }),
    }),
    fetcher: async (url, init) => {
      if (url.includes("/prices/"))
        return Response.json({
          data: {
            status: "active",
            unit_price: {
              amount: options.wrongAmount ? "1" : "7999",
              currency_code: "USD",
            },
            billing_cycle: { interval: "month", frequency: 1 },
            quantity: { minimum: 1, maximum: 1 },
          },
        });
      if (init.method === "POST") calls.purchases++;
      if (options.timeout) throw new Error("private network detail");
      return Response.json({
        data: {
          id: id("txn", 1),
          status: options.transactionStatus || "ready",
          checkout: { url: "https://checkout.example.com/" },
        },
      });
    },
  };
  return { calls, deps };
}
const checkoutRequest = () =>
  new Request("https://example.com/", {
    method: "POST",
    headers: {
      Authorization: "Bearer valid",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      vesselId: "00000000-0000-0000-0000-000000000001",
      planTier: "1_5",
      billingPeriod: "monthly",
    }),
  });
test("checkout stays disabled without flag and denies invalid auth, permissions or catalogue", async () => {
  for (const options of [
    { env: { PADDLE_CHECKOUT_ENABLED: "false" } },
    { authError: true },
    { denied: true },
    { wrongAmount: true },
  ]) {
    const { calls, deps } = harness(options);
    const response = await createPaddleCheckoutHandler(deps)(checkoutRequest());
    assert.ok(response.status >= 400);
    assert.equal(calls.purchases, 0);
    assert.equal(calls.writes, 0);
  }
});
test("new checkout persists its transaction before returning, existing ready checkout is reused", async () => {
  let h = harness();
  let response = await createPaddleCheckoutHandler(h.deps)(checkoutRequest());
  assert.equal(response.status, 200);
  assert.equal(h.calls.purchases, 1);
  assert.equal(h.calls.writes, 1);
  h = harness({
    reservation: {
      id: "checkout",
      state: "ready",
      transaction_id: id("txn", 1),
      created: false,
    },
  });
  response = await createPaddleCheckoutHandler(h.deps)(checkoutRequest());
  assert.equal(response.status, 200);
  assert.equal(h.calls.purchases, 0);
  assert.equal(h.calls.writes, 0);
});
test("ambiguous, completed and failed checkouts never silently create another purchase", async () => {
  for (const options of [
    { reservation: { state: "creating", created: false } },
    {
      reservation: { state: "ready", transaction_id: id("txn", 1) },
      transactionStatus: "completed",
    },
    { databaseError: true },
    { timeout: true },
  ]) {
    const { calls, deps } = harness(options);
    const response = await createPaddleCheckoutHandler(deps)(checkoutRequest());
    assert.ok(response.status >= 400);
    assert.ok(calls.purchases <= 1);
    assert.doesNotMatch(await response.text(), /private network detail/);
  }
});
function webhookRequest(e, valid = true) {
  const raw = JSON.stringify(e);
  const ts = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", valid ? "secret" : "forged")
    .update(`${ts}:${raw}`)
    .digest("hex");
  return new Request("https://example.com/", {
    method: "POST",
    headers: { "Paddle-Signature": `ts=${ts};h1=${signature}` },
    body: raw,
  });
}
test("webhook rejects forged input and returns failure on database errors so Paddle retries", async () => {
  let h = harness();
  let handler = createPaddleWebhookHandler(h.deps);
  assert.equal((await handler(webhookRequest(event(), false))).status, 401);
  assert.equal(h.calls.applied, 0);
  assert.equal((await handler(webhookRequest(event()))).status, 200);
  assert.equal(h.calls.applied, 1);
  h = harness({ databaseError: true });
  handler = createPaddleWebhookHandler(h.deps);
  assert.equal((await handler(webhookRequest(event()))).status, 503);
});
