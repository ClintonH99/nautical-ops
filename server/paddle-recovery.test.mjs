import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createPaddleRecoveryHandler } from "../yachy-app/supabase/functions/_shared/paddleRecovery.mjs";
import { previouslyPaid } from "../yachy-app/supabase/functions/_shared/paddlePaidHistory.mjs";
import { createPaddleWebhookHandler } from "../yachy-app/supabase/functions/_shared/paddleWebhook.mjs";

const id = (p, n = 1) => `${p}_${String(n).padStart(26, "0")}`;
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
const env = {
  PADDLE_ENV: "sandbox",
  PADDLE_SANDBOX_TRIAL_ENABLED: "true",
  PADDLE_SANDBOX_TEST_USER_IDS: "captain",
  PADDLE_SANDBOX_API_KEY: "test",
  PADDLE_PRICE_IDS: JSON.stringify(prices),
  PADDLE_CHECKOUT_URL: "https://example.test/checkout",
  PADDLE_WEBHOOK_SECRET: "test-secret",
};
function harness(options = {}) {
  const calls = [];
  const billing = {
    subscription_id: id("sub"),
    customer_id: id("ctm"),
    environment: "sandbox",
    ...options.billing,
  };
  const subscription = {
    id: id("sub"),
    customer_id: id("ctm"),
    status: "past_due",
    collection_mode: "automatic",
    ...options.subscription,
  };
  const transaction = {
    id: id("txn"),
    subscription_id: id("sub"),
    customer_id: id("ctm"),
    status: "past_due",
    collection_mode: "automatic",
    currency_code: "USD",
    details: { totals: { balance: "7999" } },
    checkout: { url: `https://example.test/checkout?_ptxn=${id("txn")}` },
    ...options.transaction,
  };
  const handler = createPaddleRecoveryHandler({
    getEnv: (key) => ({ ...env, ...options.env })[key],
    createClient: () => ({
      auth: {
        getUser: async () => ({
          data: {
            user: options.noUser ? null : { id: options.user || "captain" },
          },
        }),
      },
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: billing, error: options.denied };
      },
    }),
    fetcher: async (url, init) => {
      calls.push({ url, method: init.method || "GET" });
      if (options.outage) throw new Error("private provider data");
      return Response.json({
        data: url.endsWith("update-payment-method-transaction")
          ? transaction
          : subscription,
      });
    },
  });
  return {
    calls,
    run: () =>
      handler(
        new Request("https://example.test/recover", {
          method: "POST",
          headers: { authorization: "Bearer test" },
          body: JSON.stringify({
            vesselId,
            subscription_id: "forged",
            customer_id: "forged",
            amount: 1,
          }),
        }),
      ),
  };
}
test("recovery reuses the bound overdue transaction with only provider GETs", async () => {
  const h = harness();
  const response = await h.run();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).purpose, "payment_recovery");
  assert.deepEqual(h.calls[0], {
    name: "get_paddle_recovery_billing",
    args: { p_vessel_id: vesselId },
  });
  assert.ok(
    h.calls
      .slice(1)
      .every((call) => call.method === "GET" && !call.url.includes("forged")),
  );
});
test("recovery blocks live, unapproved users, missing sessions and denied Captain/device lookup before provider access", async () => {
  for (const [options, status] of [
    [{ env: { PADDLE_ENV: "live" } }, 503],
    [{ env: { PADDLE_SANDBOX_TRIAL_ENABLED: "false" } }, 503],
    [{ user: "crew" }, 403],
    [{ noUser: true }, 401],
    [{ denied: true }, 409],
    [{ billing: { environment: "live" } }, 409],
  ]) {
    const h = harness(options);
    assert.equal((await h.run()).status, status);
    assert.equal(h.calls.filter((c) => c.url).length, 0);
  }
});
test("recovery refuses wrong bindings, trial/active/canceled states, zero balances and hostile links", async () => {
  for (const options of [
    { subscription: { customer_id: id("ctm", 2) } },
    { subscription: { status: "active" } },
    { subscription: { status: "trialing" } },
    { subscription: { status: "canceled" } },
    { transaction: { subscription_id: id("sub", 2) } },
    { transaction: { customer_id: id("ctm", 2) } },
    { transaction: { status: "completed" } },
    { transaction: { currency_code: "EUR" } },
    { transaction: { details: { totals: { balance: "0" } } } },
    { transaction: { checkout: { url: "https://evil.example/checkout" } } },
  ])
    assert.notEqual((await harness(options).run()).status, 200);
});
test("provider outage never updates entitlement or leaks provider data", async () => {
  const h = harness({ outage: true });
  const response = await h.run();
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private provider data/);
  assert.equal(h.calls.filter((c) => c.name).length, 1);
});

const event = {
  subscription_id: id("sub"),
  customer_id: id("ctm"),
  period_start: "2030-02-01T00:00:00Z",
  occurred_at: "2030-02-01T00:01:00Z",
};
const paid = {
  id: id("txn"),
  subscription_id: id("sub"),
  customer_id: id("ctm"),
  status: "completed",
  origin: "subscription_recurring",
  collection_mode: "automatic",
  details: { totals: { grand_total: "7999" } },
  payments: [
    { status: "captured", amount: "7999", captured_at: "2030-01-01T00:01:00Z" },
  ],
};
const config = { base: "https://sandbox-api.paddle.com", apiKey: "test" };
const page = (data, has_more = false) =>
  Response.json({ data, meta: { pagination: { has_more } } });
test("only captured historical subscription payments qualify, not a trial or card setup", async () => {
  assert.equal(
    await previouslyPaid(config, event, async () => page([paid])),
    true,
  );
  for (const candidate of [
    null,
    { ...paid, origin: "subscription_payment_method_change" },
    { ...paid, details: { totals: { grand_total: "0" } } },
    { ...paid, payments: [{ ...paid.payments[0], status: "error" }] },
    {
      ...paid,
      payments: [{ ...paid.payments[0], captured_at: "2030-02-01T00:02:00Z" }],
    },
  ]) {
    assert.equal(
      await previouslyPaid(config, event, async () =>
        page(candidate ? [candidate] : []),
      ),
      false,
    );
  }
});
test("payment-history pagination finds older paid entries without following provider URLs", async () => {
  const urls = [];
  assert.equal(
    await previouslyPaid(config, event, async (url) => {
      urls.push(url);
      return urls.length === 1
        ? page(
            [{ ...paid, origin: "subscription_payment_method_change" }],
            true,
          )
        : page([paid]);
    }),
    true,
  );
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]).searchParams.get("after"), id("txn"));
  assert.equal(new URL(urls[1]).searchParams.get("subscription_id"), id("sub"));
});
test("incomplete, cross-customer or unavailable history is unknown, never false", async () => {
  for (const fetcher of [
    async () => {
      throw new Error("offline");
    },
    async () => Response.json({ data: [] }),
    async () => page([{ ...paid, customer_id: id("ctm", 2) }]),
    async () => page([], true),
  ])
    await assert.rejects(() => previouslyPaid(config, event, fetcher));
});
test("signed past-due webhook enriches payment proof; history failure causes retry without writing entitlement", async () => {
  const raw = JSON.stringify({
    event_id: id("evt"),
    event_type: "subscription.past_due",
    occurred_at: event.occurred_at,
    data: {
      id: id("sub"),
      customer_id: id("ctm"),
      status: "past_due",
      collection_mode: "automatic",
      items: [{ quantity: 1, price: { id: prices["1_5"].monthly } }],
      current_billing_period: {
        starts_at: event.period_start,
        ends_at: "2030-03-01T00:00:00Z",
      },
    },
  });
  const ts = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", env.PADDLE_WEBHOOK_SECRET)
    .update(`${ts}:${raw}`)
    .digest("hex");
  const request = () =>
    new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "Paddle-Signature": `ts=${ts};h1=${signature}` },
      body: raw,
    });
  for (const outage of [false, true]) {
    const writes = [];
    const handler = createPaddleWebhookHandler({
      getEnv: (k) => env[k],
      createClient: () => ({
        rpc: async (name, args) => {
          writes.push(args.p_event);
          return { error: null };
        },
      }),
      fetcher: async () => {
        if (outage) throw new Error("offline");
        return page([paid]);
      },
    });
    assert.equal((await handler(request())).status, outage ? 503 : 200);
    assert.equal(writes.length, outage ? 0 : 1);
    if (!outage) {
      assert.equal(writes[0].paid_history_verified, true);
      assert.equal(writes[0].previously_paid, true);
    }
  }
});
