import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createPaddleReactivationHandler } from "../yachy-app/supabase/functions/_shared/paddleReactivation.mjs";
import { createPaddleWebhookHandler } from "../yachy-app/supabase/functions/_shared/paddleWebhook.mjs";

const id = (p, n = 1) => `${p}_${String(n).padStart(26, "0")}`;
const vesselId = "00000000-0000-0000-0000-000000000001";
const checkoutId = "00000000-0000-0000-0000-000000000002";
const prices = Object.fromEntries(
  ["1_5", "6_10", "11_15", "16_25", "26_40", "40_plus"].map((tier, i) => [
    tier,
    Object.fromEntries(
      ["monthly", "3_months", "6_months", "12_months"].map((period, j) => [
        period,
        id("pri", i * 4 + j),
      ]),
    ),
  ]),
);
const paidPrice = {
  id: id("pri", 100),
  status: "active",
  unit_price: { amount: "7999", currency_code: "USD" },
  trial_period: null,
  billing_cycle: { interval: "month", frequency: 1 },
  tax_mode: "external",
  quantity: { minimum: 1, maximum: 1 },
};
const env = {
  PADDLE_ENV: "sandbox",
  PADDLE_SANDBOX_TRIAL_ENABLED: "true",
  PADDLE_SANDBOX_TEST_USER_IDS: "captain",
  PADDLE_SANDBOX_API_KEY: "fake",
  PADDLE_PRICE_IDS: JSON.stringify(prices),
  PADDLE_PAID_PRICE_IDS: JSON.stringify({ "1_5": { monthly: paidPrice.id } }),
  PADDLE_WEBHOOK_SECRET: "test-only",
  PADDLE_CHECKOUT_URL: "https://example.test/checkout",
};
const transaction = {
  id: id("txn"),
  status: "ready",
  customer_id: id("ctm"),
  subscription_id: null,
  collection_mode: "automatic",
  currency_code: "USD",
  custom_data: { checkout_id: checkoutId },
  items: [{ quantity: 1, price: paidPrice }],
  checkout: { url: `https://example.test/checkout?_ptxn=${id("txn")}` },
};
function harness(options = {}) {
  const calls = [];
  const billing = {
    environment: "sandbox",
    subscription_id: id("sub"),
    customer_id: id("ctm"),
    plan_tier: "1_5",
    billing_period: "monthly",
    ...options.billing,
  };
  const handler = createPaddleReactivationHandler({
    getEnv: (k) => ({ ...env, ...options.env })[k],
    createClient: () => ({
      auth: {
        getUser: async () => ({
          data: { user: options.anonymous ? null : { id: "captain" } },
        }),
      },
      rpc: async (name, args) => {
        calls.push({ name, args });
        return {
          data:
            name === "get_paddle_reactivation_billing"
              ? billing
              : {
                  id: checkoutId,
                  state: "creating",
                  created: true,
                  ...options.intent,
                },
          error: options.denied,
        };
      },
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: async () => {
                calls.push({ save: true });
                return { data: [{ id: checkoutId }], error: options.saveError };
              },
            }),
          }),
        }),
      }),
    }),
    fetcher: async (url, init) => {
      calls.push({
        url,
        method: init.method || "GET",
        body: init.body ? JSON.parse(init.body) : null,
      });
      if (options.timeout && init.method === "POST")
        throw new Error("private provider response");
      return Response.json({
        data: url.includes("/subscriptions/")
          ? {
              id: id("sub"),
              customer_id: id("ctm"),
              status: "canceled",
              canceled_at: "2020-01-01",
              collection_mode: "automatic",
              currency_code: "USD",
              ...options.old,
            }
          : url.includes("/prices/")
            ? { ...paidPrice, ...options.price }
            : { ...transaction, ...options.transaction },
      });
    },
  });
  return {
    calls,
    run: () =>
      handler(
        new Request("https://example.test/reactivate", {
          method: "POST",
          headers: { authorization: "Bearer synthetic" },
          body: JSON.stringify({
            vesselId,
            priceId: "forged",
            customer_id: "forged",
            amount: 1,
          }),
        }),
      ),
  };
}
test("expired reactivation creates one paid-only checkout, preserves customer, and does not activate or bill automatically", async () => {
  const h = harness();
  const r = await h.run();
  assert.equal(r.status, 200);
  assert.equal((await r.json()).purpose, "paid_reactivation");
  const post = h.calls.find((c) => c.method === "POST");
  assert.deepEqual(post.body.items, [{ price_id: paidPrice.id, quantity: 1 }]);
  assert.equal(post.body.customer_id, id("ctm"));
  assert.equal(post.body.status, undefined);
  assert.equal(h.calls.filter((c) => c.method === "POST").length, 1);
  assert.ok(!h.calls.some((c) => c.url?.includes("/activate")));
});
test("ready retry reuses the existing transaction and ambiguous reservations never create another", async () => {
  const h = harness({
    intent: { state: "ready", created: false, transaction_id: id("txn") },
  });
  assert.equal((await h.run()).status, 200);
  assert.ok(h.calls.filter((c) => c.url).every((c) => c.method === "GET"));
  const pending = harness({ intent: { created: false } });
  assert.equal((await pending.run()).status, 409);
  assert.ok(!pending.calls.some((c) => c.method === "POST"));
});
test("unauthorized, active, overdue, wrong-customer and unconfigured/no-trial-price failures never create checkout", async () => {
  for (const options of [
    { anonymous: true },
    { denied: true },
    { old: { status: "active" } },
    { old: { status: "trialing" } },
    { old: { status: "past_due" } },
    { old: { customer_id: id("ctm", 2) } },
    { old: { canceled_at: "2099-01-01" } },
    { env: { PADDLE_PAID_PRICE_IDS: "" } },
    { price: { trial_period: { interval: "day", frequency: 30 } } },
    { price: { unit_price: { amount: "1", currency_code: "USD" } } },
    { price: { tax_mode: "internal" } },
    { price: { quantity: { minimum: 1, maximum: 40 } } },
    { billing: { environment: "live" } },
  ]) {
    const h = harness(options);
    assert.ok((await h.run()).status >= 400);
    assert.ok(!h.calls.some((c) => c.method === "POST"));
  }
});
test("live rollout cannot fall back to sandbox price map or credentials", async () => {
  const h = harness({
    env: {
      PADDLE_ENV: "live",
      PADDLE_CHECKOUT_ENABLED: "true",
      PADDLE_LIVE_BILLING_ENABLED: "true",
      PADDLE_LIVE_API_KEY: "fake-live",
      PADDLE_LIVE_PRICE_IDS: JSON.stringify(prices),
    },
    billing: { environment: "live" },
  });
  assert.equal((await h.run()).status, 503);
  assert.ok(!h.calls.some((c) => c.method === "POST"));
});
test("provider ambiguity, mismatched transactions and failed binding never return a payment URL", async () => {
  for (const options of [
    { timeout: true },
    { saveError: true },
    { transaction: { customer_id: id("ctm", 2) } },
    { transaction: { status: "completed" } },
    { transaction: { subscription_id: id("sub") } },
    { transaction: { custom_data: { checkout_id: "forged" } } },
    { transaction: { checkout: { url: "https://evil.example" } } },
  ]) {
    const h = harness(options);
    const r = await h.run();
    assert.ok(r.status >= 400);
    assert.doesNotMatch(await r.text(), /private provider response/);
  }
});

const created = {
  event_id: id("evt"),
  event_type: "subscription.created",
  occurred_at: new Date().toISOString(),
  data: {
    id: id("sub", 2),
    customer_id: id("ctm"),
    status: "active",
    collection_mode: "automatic",
    items: [{ quantity: 1, price: paidPrice }],
    custom_data: { checkout_id: checkoutId },
    transaction_id: id("txn"),
    current_billing_period: { starts_at: "2026-10-30", ends_at: "2026-11-30" },
  },
};
async function webhook(options = {}) {
  let applied = null;
  const handler = createPaddleWebhookHandler({
    getEnv: (k) => env[k],
    createClient: () => ({
      rpc: async (_name, args) => {
        applied = args.p_event;
        return {};
      },
    }),
    fetcher: async () =>
      Response.json({
        data: {
          ...transaction,
          status: "completed",
          subscription_id: id("sub", 2),
          details: { totals: { balance: "0" } },
          ...options.transaction,
        },
      }),
  });
  const payload = { ...created, data: { ...created.data, ...options.data } };
  const raw = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", env.PADDLE_WEBHOOK_SECRET)
    .update(`${ts}:${raw}`)
    .digest("hex");
  const r = await handler(
    new Request("https://example.test/webhook", {
      method: "POST",
      body: raw,
      headers: { "Paddle-Signature": `ts=${ts};h1=${sig}` },
    }),
  );
  return { status: r.status, applied };
}
test("signed paid reactivation requires a completed, fully settled, matching Paddle transaction", async () => {
  const success = await webhook();
  assert.equal(success.status, 200);
  assert.equal(success.applied.initial_payment_verified, true);
  for (const transaction of [
    { status: "ready" },
    { customer_id: id("ctm", 2) },
    { subscription_id: id("sub", 3) },
    { custom_data: { checkout_id: "forged" } },
    { details: { totals: { balance: "1" } } },
    { items: [{ quantity: 2, price: paidPrice }] },
  ]) {
    const result = await webhook({ transaction });
    assert.equal(result.status, 503);
    assert.equal(result.applied, null);
  }
  const trial = await webhook({ data: { status: "trialing" } });
  assert.equal(trial.status, 422);
  assert.equal(trial.applied, null);
});
