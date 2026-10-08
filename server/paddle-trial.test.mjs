import test from "node:test";
import assert from "node:assert/strict";
import { createPaddleTrialHandler } from "../yachy-app/supabase/functions/_shared/paddleTrial.mjs";
import { createPaddleTrialPaymentHandler } from "../yachy-app/supabase/functions/_shared/paddleTrialPayment.mjs";

const id = (prefix, n = 1) => `${prefix}_${String(n).padStart(26, "0")}`;
const vesselId = "00000000-0000-0000-0000-000000000001";
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
const price = {
  id: prices["1_5"].monthly,
  status: "active",
  unit_price: { amount: "7999", currency_code: "USD" },
  billing_cycle: { interval: "month", frequency: 1 },
  trial_period: {
    interval: "day",
    frequency: 30,
    requires_payment_method: false,
  },
  quantity: { minimum: 1, maximum: 1 },
  tax_mode: "external",
};
const totals = {
  total: "0",
  grand_total: "0",
  balance: "0",
  currency_code: "USD",
};
const request = (body = {}, authorization = true) =>
  new Request("https://example.test/trial", {
    method: "POST",
    headers: authorization ? { authorization: "Bearer user-token" } : {},
    body: JSON.stringify({
      vesselId,
      planTier: "1_5",
      billingPeriod: "monthly",
      countryCode: "FR",
      postalCode: "75001",
      ...body,
    }),
  });
function harness(options = {}) {
  const calls = [];
  const env = {
    PADDLE_ENV: "sandbox",
    PADDLE_SANDBOX_TRIAL_ENABLED: "true",
    PADDLE_SANDBOX_TEST_USER_IDS: "captain",
    PADDLE_SANDBOX_API_KEY: "test-key",
    PADDLE_PRICE_IDS: JSON.stringify(prices),
    PADDLE_CHECKOUT_URL: "https://example.test/checkout",
    ...options.env,
  };
  const transaction = {
    id: id("txn"),
    status: "ready",
    custom_data: { checkout_id: "intent" },
    customer_id: id("ctm"),
    subscription_id: id("sub"),
    collection_mode: "automatic",
    currency_code: "USD",
    items: [{ price, quantity: 1 }],
    details: { totals },
    origin: "subscription_payment_method_change",
    checkout: { url: `https://example.test/checkout?_ptxn=${id("txn")}` },
    ...options.transaction,
  };
  const billing = {
    subscription_id: id("sub"),
    customer_id: id("ctm"),
    environment: "sandbox",
    plan_tier: "1_5",
    billing_period: "monthly",
    trial_end: "2030-02-01T00:00:00Z",
    ...options.billing,
  };
  const subscription = {
    id: id("sub"),
    customer_id: id("ctm"),
    status: "trialing",
    collection_mode: "automatic",
    items: [{ price, quantity: 1 }],
    current_billing_period: { ends_at: "2030-02-01T00:00:00Z" },
    ...options.subscription,
  };
  const deps = {
    getEnv: (k) => env[k],
    now: () => Date.parse("2030-01-15T00:00:00Z"),
    createClient: () => ({
      auth: {
        getUser: async () => ({
          data: {
            user: options.authError
              ? null
              : {
                  id: options.userId || "captain",
                  email: "captain@example.test",
                },
          },
        }),
      },
      rpc: async (name) => {
        calls.push(name);
        return {
          error: options.denied,
          data:
            name === "get_paddle_trial_billing"
              ? billing
              : options.intent || {
                  id: "intent",
                  created: true,
                  state: "creating",
                },
        };
      },
      from: () => ({
        update: () => {
          calls.push("save-binding");
          const q = {
            eq: () => q,
            select: async () => ({
              data: options.saveError ? [] : [{ id: "intent" }],
            }),
          };
          return q;
        },
      }),
    }),
    fetcher: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push(`${init.method || "GET"} ${path}`);
      let data;
      if (path.startsWith("/prices/")) data = { ...price, ...options.price };
      else if (path === "/customers" && !init.method)
        data = options.customers || [];
      else if (path === "/customers") {
        assert.equal(JSON.parse(init.body).email, "captain@example.test");
        data = { id: id("ctm") };
      } else if (path.endsWith("/addresses")) data = { id: id("add") };
      else if (path === "/transactions") {
        assert.equal(JSON.parse(init.body).status, undefined);
        data = transaction;
      } else if (path === `/transactions/${id("txn")}`) {
        if (init.method === "PATCH") {
          assert.deepEqual(JSON.parse(init.body), { status: "billed" });
          if (options.timeout) throw new Error("network");
        }
        data = transaction;
      } else if (path === `/subscriptions/${id("sub")}`) data = subscription;
      else if (path.endsWith("/update-payment-method-transaction"))
        data = transaction;
      else throw new Error(`Unexpected provider request ${path}`);
      return Response.json({ data });
    },
  };
  return {
    calls,
    trial: createPaddleTrialHandler(deps),
    payment: createPaddleTrialPaymentHandler(deps),
  };
}
test("trial saves transaction binding before billing and grants no browser entitlement", async () => {
  const h = harness();
  const r = await h.trial(request());
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), {
    state: "pending_confirmation",
    environment: "sandbox",
  });
  assert(
    h.calls.indexOf("save-binding") <
      h.calls.indexOf(`PATCH /transactions/${id("txn")}`),
  );
  assert(!h.calls.some((c) => c.includes("apply_paddle")));
});
test("trial reuses exact existing customer rather than creating a duplicate", async () => {
  const h = harness({
    customers: [{ id: id("ctm"), email: "captain@example.test" }],
  });
  assert.equal((await h.trial(request())).status, 202);
  assert(!h.calls.includes("POST /customers"));
});
test("missing French postcode is rejected before reserving a trial or contacting Paddle", async () => {
  const h = harness();
  const r = await h.trial(request({ postalCode: "" }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /postal code/);
  assert.deepEqual(h.calls, []);
});
test("trial refuses mismatched customer and nonzero initial charge", async () => {
  for (const opts of [
    { customers: [{ id: id("ctm"), email: "other@example.test" }] },
    { transaction: { details: { totals: { ...totals, grand_total: "1" } } } },
    { transaction: { custom_data: { checkout_id: "wrong" } } },
    {
      price: {
        trial_period: {
          interval: "day",
          frequency: 30,
          requires_payment_method: true,
        },
      },
    },
  ]) {
    const h = harness(opts);
    assert((await h.trial(request())).status >= 400);
    assert(!h.calls.some((c) => c.startsWith("PATCH")));
  }
});
test("trial retry uses only the reserved transaction and never starts another trial", async () => {
  for (const status of ["ready", "billed", "paid", "completed"]) {
    const h = harness({
      intent: {
        id: "intent",
        created: false,
        state: "ready",
        transaction_id: id("txn"),
      },
      transaction: { status },
    });
    assert.equal((await h.trial(request())).status, 202);
    assert(!h.calls.includes("POST /transactions"));
    assert(!h.calls.includes("POST /customers"));
    assert.equal(
      h.calls.filter((c) => c.startsWith("PATCH")).length,
      status === "ready" ? 1 : 0,
    );
  }
});
test("ambiguous reservations, failed binding and provider timeouts never silently retry", async () => {
  for (const opts of [
    { intent: { id: "intent", created: false, state: "creating" } },
    { saveError: true },
    { timeout: true },
  ]) {
    const h = harness(opts);
    assert((await h.trial(request())).status >= 400);
    assert(h.calls.filter((c) => c === "POST /transactions").length <= 1);
    if (!opts.timeout) assert(!h.calls.some((c) => c.startsWith("PATCH")));
  }
});
test("both sandbox endpoints deny live, disabled, anonymous, unlisted and unauthorized requests", async () => {
  for (const kind of ["trial", "payment"])
    for (const opts of [
      { env: { PADDLE_ENV: "live" } },
      { env: { PADDLE_SANDBOX_TRIAL_ENABLED: "false" } },
      { env: { PADDLE_SANDBOX_TEST_USER_IDS: "" } },
      { authError: true },
      { userId: "outsider" },
      { denied: true },
    ]) {
      const h = harness(opts);
      assert((await h[kind](request())).status >= 400);
      assert(
        !h.calls.some(
          (c) =>
            c.startsWith("POST ") ||
            c.startsWith("PATCH ") ||
            c.endsWith("update-payment-method-transaction"),
        ),
      );
    }
});
test("payment setup uses the existing subscription zero-charge update, never activation", async () => {
  const h = harness();
  const r = await h.payment(request({ subscriptionId: "attacker-value" }));
  assert.equal(r.status, 200);
  const result = await r.json();
  assert.equal(result.purpose, "trial_payment_method");
  assert.equal(result.trialEnd, "2030-02-01T00:00:00.000Z");
  assert.deepEqual(h.calls, [
    "get_paddle_trial_billing",
    `GET /subscriptions/${id("sub")}`,
    `GET /subscriptions/${id("sub")}/update-payment-method-transaction`,
  ]);
});
test("payment setup rejects expired, changed, canceled, wrong-owner or wrong-environment trial", async () => {
  for (const opts of [
    { subscription: { status: "active" } },
    { subscription: { status: "past_due" } },
    { subscription: { scheduled_change: { action: "cancel" } } },
    { subscription: { customer_id: id("ctm", 2) } },
    {
      subscription: {
        current_billing_period: { ends_at: "2030-03-01T00:00:00Z" },
      },
    },
    {
      subscription: {
        current_billing_period: { ends_at: "2020-01-01T00:00:00Z" },
      },
    },
    { billing: { environment: "live" } },
  ]) {
    const h = harness(opts);
    assert((await h.payment(request())).status >= 400);
    assert(
      !h.calls.some((c) => c.endsWith("update-payment-method-transaction")),
    );
  }
});
test("payment setup rejects nonzero, new-subscription or untrusted checkout transactions", async () => {
  for (const transaction of [
    { details: { totals: { ...totals, total: "1" } } },
    { details: { totals: { ...totals, balance: "1" } } },
    { customer_id: id("ctm", 2) },
    { subscription_id: id("sub", 2) },
    { origin: "web" },
    { status: "past_due" },
    { checkout: { url: `https://evil.example/checkout?_ptxn=${id("txn")}` } },
  ]) {
    const h = harness({ transaction });
    assert((await h.payment(request())).status >= 400);
  }
});
