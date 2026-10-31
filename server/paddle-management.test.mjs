import test from "node:test";
import assert from "node:assert/strict";
import { createPaddleManagementHandler } from "../yachy-app/supabase/functions/_shared/paddleManagement.mjs";
import { requirePaddleBilling } from "../yachy-app/supabase/functions/_shared/paddleRollout.mjs";

const id = (p, n = 1) => `${p}_${String(n).padStart(26, "0")}`;
const vesselId = "00000000-0000-0000-0000-000000000001";
const end = "2030-02-01T00:00:00.000Z";
const prices = Object.fromEntries(
  ["1_5", "6_10", "11_15", "16_25", "26_40", "40_plus"].map((t, i) => [
    t,
    Object.fromEntries(
      ["monthly", "3_months", "6_months", "12_months"].map((p, j) => [
        p,
        id("pri", i * 4 + j),
      ]),
    ),
  ]),
);
function harness(options = {}) {
  const calls = [];
  const environment = options.environment || "sandbox";
  const env = {
    PADDLE_ENV: environment,
    PADDLE_SANDBOX_TRIAL_ENABLED: "true",
    PADDLE_SUBSCRIPTION_MANAGEMENT_ENABLED: "true",
    PADDLE_SANDBOX_TEST_USER_IDS: "captain",
    PADDLE_SANDBOX_API_KEY: "sandbox-key",
    PADDLE_LIVE_API_KEY: "live-key",
    PADDLE_PRICE_IDS: JSON.stringify(prices),
    PADDLE_LIVE_PRICE_IDS: JSON.stringify(prices),
    PADDLE_CHECKOUT_URL: "https://example.test/checkout",
    ...options.env,
  };
  const subscription = {
    id: id("sub"),
    customer_id: id("ctm"),
    status: "active",
    collection_mode: "automatic",
    currency_code: "USD",
    current_billing_period: { ends_at: end },
    scheduled_change: null,
    items: [{ quantity: 1, price: { id: prices["1_5"].monthly } }],
    ...options.subscription,
  };
  const transaction = {
    id: id("txn"),
    subscription_id: id("sub"),
    customer_id: id("ctm"),
    origin: "subscription_payment_method_change",
    status: "ready",
    collection_mode: "automatic",
    currency_code: "USD",
    details: {
      totals: {
        total: "0",
        grand_total: "0",
        balance: "0",
        currency_code: "USD",
      },
    },
    checkout: { url: `https://example.test/checkout?_ptxn=${id("txn")}` },
    ...options.transaction,
  };
  const handler = createPaddleManagementHandler({
    getEnv: (k) => env[k],
    now: () => Date.parse("2030-01-15T00:00:00Z"),
    createClient: (_url, _key, settings) => {
      assert.equal(settings.global.headers.Authorization, "Bearer test");
      return {
        auth: {
          getUser: async () => ({
            data: {
              user: options.anonymous
                ? null
                : { id: options.user || "captain" },
            },
          }),
        },
        rpc: async (name, args) => {
          calls.push({ name, args });
          return {
            error: options.denied,
            data: {
              environment,
              subscription_id: id("sub"),
              customer_id: id("ctm"),
              plan_tier: "1_5",
              billing_period: "monthly",
              period_end: end,
              ...options.billing,
            },
          };
        },
      };
    },
    fetcher: async (url, init) => {
      calls.push({
        url,
        method: init.method || "GET",
        body: init.body && JSON.parse(init.body),
      });
      assert.equal(
        new URL(url).origin,
        environment === "live"
          ? "https://api.paddle.com"
          : "https://sandbox-api.paddle.com",
      );
      assert.equal(
        init.headers.Authorization,
        `Bearer ${environment === "live" ? "live-key" : "sandbox-key"}`,
      );
      if (
        options.outage ||
        (options.cancelTimeout && url.endsWith("/cancel")) ||
        (options.keepTimeout && init.method === "PATCH")
      )
        throw new Error("private secret");
      return Response.json({
        data: url.endsWith("/cancel")
          ? {
              ...subscription,
              scheduled_change: { action: "cancel", effective_at: end },
              ...options.cancelResult,
            }
          : url.endsWith("/update-payment-method-transaction")
            ? transaction
            : init.method === "PATCH"
              ? {
                  ...subscription,
                  scheduled_change: null,
                  next_billed_at: end,
                  ...options.keepResult,
                }
              : subscription,
      });
    },
  });
  return {
    calls,
    run: (action = "status", body = {}, method = "POST") =>
      handler(
        new Request("https://example.test/manage", {
          method,
          headers: { authorization: "Bearer test" },
          ...(method === "POST"
            ? {
                body: JSON.stringify({
                  vesselId,
                  action,
                  subscription_id: "forged",
                  customer_id: "forged",
                  ...body,
                }),
              }
            : {}),
        }),
      ),
  };
}

test("reactivated paid-only subscriptions retain management and cancellation", async () => {
  const paid = id("pri", 100);
  const h = harness({
    env: {
      PADDLE_PAID_PRICE_IDS: JSON.stringify({ "1_5": { monthly: paid } }),
    },
    subscription: { items: [{ quantity: 1, price: { id: paid } }] },
  });
  assert.equal((await h.run()).status, 200);
  assert.equal(
    (await h.run("cancel_renewal", { confirm: true, periodEnd: end })).status,
    200,
  );
});
test("live requires both explicit switches and never falls back to the sandbox flag", () => {
  for (const env of [
    {},
    { PADDLE_ENV: "live", PADDLE_SANDBOX_TRIAL_ENABLED: "true" },
    { PADDLE_ENV: "live", PADDLE_CHECKOUT_ENABLED: "true" },
    { PADDLE_ENV: "live", PADDLE_LIVE_BILLING_ENABLED: "true" },
    {
      PADDLE_ENV: "unknown",
      PADDLE_LIVE_BILLING_ENABLED: "true",
      PADDLE_CHECKOUT_ENABLED: "true",
    },
  ])
    assert.throws(() => requirePaddleBilling((k) => env[k]));
  assert.equal(
    requirePaddleBilling(
      (k) =>
        ({
          PADDLE_ENV: "live",
          PADDLE_LIVE_BILLING_ENABLED: "true",
          PADDLE_CHECKOUT_ENABLED: "true",
        })[k],
    ),
    "live",
  );
});
test("management authenticates and binds subscription lookup to vessel and environment", async () => {
  for (const environment of ["sandbox", "live"]) {
    const h = harness({
      environment,
      env: {
        PADDLE_LIVE_BILLING_ENABLED: "true",
        PADDLE_CHECKOUT_ENABLED: "true",
      },
    });
    const response = await h.run();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      environment,
      status: "active",
      periodEnd: end,
      cancellationScheduled: false,
    });
    assert.deepEqual(h.calls[0], {
      name: "get_paddle_management_billing",
      args: { p_vessel_id: vesselId, p_environment: environment },
    });
    assert.ok(h.calls[1].url.endsWith(`/subscriptions/${id("sub")}`));
    assert.equal(h.calls.length, 2);
  }
});
test("disabled, unlisted, unauthenticated, wrong-environment and denied lookup stop before Paddle", async () => {
  for (const options of [
    { environment: "live" },
    { env: { PADDLE_SUBSCRIPTION_MANAGEMENT_ENABLED: "false" } },
    { user: "crew" },
    { anonymous: true },
    { denied: true },
    { billing: { environment: "live" } },
    { billing: { subscription_id: "forged" } },
  ]) {
    const h = harness(options);
    assert.notEqual((await h.run()).status, 200);
    assert.equal(h.calls.filter((c) => c.url).length, 0);
  }
});
test("payment update accepts only a bound zero-value active-subscription transaction", async () => {
  const h = harness();
  const response = await h.run("payment_method");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).purpose, "payment_method");
  assert.ok(h.calls.filter((c) => c.url).every((c) => c.method === "GET"));
  for (const options of [
    { subscription: { customer_id: id("ctm", 2) } },
    { subscription: { status: "past_due" } },
    { subscription: { status: "trialing" } },
    {
      subscription: {
        items: [{ quantity: 2, price: { id: prices["1_5"].monthly } }],
      },
    },
    {
      subscription: {
        current_billing_period: { ends_at: "2030-03-01T00:00:00Z" },
      },
    },
    { transaction: { customer_id: id("ctm", 2) } },
    { transaction: { subscription_id: id("sub", 2) } },
    { transaction: { origin: "subscription_recurring" } },
    { transaction: { currency_code: "EUR" } },
    {
      transaction: {
        details: {
          totals: {
            total: "0",
            grand_total: "0",
            balance: "1",
            currency_code: "USD",
          },
        },
      },
    },
    { transaction: { checkout: { url: "https://evil.example/checkout" } } },
  ])
    assert.notEqual((await harness(options).run("payment_method")).status, 200);
});
test("cancellation requires confirmation of the unchanged date and posts end-of-period only", async () => {
  for (const body of [
    {},
    { confirm: false, periodEnd: end },
    { confirm: true, periodEnd: "2030-03-01" },
  ]) {
    const h = harness();
    assert.equal((await h.run("cancel_renewal", body)).status, 409);
    assert.ok(h.calls.filter((c) => c.url).every((c) => c.method === "GET"));
  }
  for (const status of ["active", "trialing", "past_due"]) {
    const h = harness({ subscription: { status } });
    const response = await h.run("cancel_renewal", {
      confirm: true,
      periodEnd: end,
      effective_from: "immediately",
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, "pending_confirmation");
    assert.deepEqual(h.calls.at(-1).body, {
      effective_from: "next_billing_period",
    });
    assert.equal(h.calls.filter((c) => c.method === "POST").length, 1);
  }
});
test("already scheduled cancellation is idempotent; other scheduled changes and ambiguous responses fail closed", async () => {
  const h = harness({
    subscription: { scheduled_change: { action: "cancel", effective_at: end } },
  });
  assert.equal(
    (await h.run("cancel_renewal", { confirm: true, periodEnd: end })).status,
    200,
  );
  assert.ok(h.calls.filter((c) => c.url).every((c) => c.method === "GET"));
  for (const options of [
    {
      subscription: {
        scheduled_change: { action: "pause", effective_at: end },
      },
    },
    { cancelResult: { scheduled_change: null } },
    { cancelResult: { customer_id: id("ctm", 2) } },
    { cancelResult: { status: "canceled" } },
    { cancelTimeout: true },
    { outage: true },
  ]) {
    const h = harness(options);
    const response = await h.run("cancel_renewal", {
      confirm: true,
      periodEnd: end,
    });
    assert.notEqual(response.status, 200);
    assert.doesNotMatch(await response.text(), /private secret/);
    assert.ok(h.calls.filter((c) => c.method === "POST").length <= 1);
    assert.equal(h.calls.filter((c) => c.name).length, 1); // no entitlement writes
  }
});
test("unsupported actions and GET requests cannot trigger management", async () => {
  const h = harness();
  assert.equal((await h.run("activate")).status, 400);
  assert.equal((await h.run("status", {}, "GET")).status, 405);
  assert.equal(h.calls.length, 0);
});

test("keeping a subscription removes only the future cancellation, with explicit date confirmation", async () => {
  for (const status of ["active", "trialing"]) {
    const h = harness({
      subscription: {
        status,
        scheduled_change: { action: "cancel", effective_at: end },
      },
    });
    const response = await h.run("keep_subscription", {
      confirm: true,
      periodEnd: end,
      items: [],
      next_billed_at: "2040-01-01",
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, "pending_confirmation");
    assert.deepEqual(h.calls.at(-1).body, { scheduled_change: null });
    assert.equal(h.calls.at(-1).method, "PATCH");
    assert.equal(h.calls.filter((c) => c.name).length, 1);
    assert.equal(h.calls.filter((c) => c.method === "PATCH").length, 1);
    assert.equal(h.calls.filter((c) => c.method === "POST").length, 0);
  }
  for (const body of [
    {},
    { confirm: false, periodEnd: end },
    { confirm: true, periodEnd: "2031-01-01" },
  ]) {
    const h = harness({
      subscription: {
        scheduled_change: { action: "cancel", effective_at: end },
      },
    });
    assert.equal((await h.run("keep_subscription", body)).status, 409);
    assert.equal(h.calls.filter((c) => c.method === "PATCH").length, 0);
  }
});
test("keep subscription is idempotent and rejects expired, unpaid, changed or unauthorized subscriptions", async () => {
  const h = harness();
  assert.equal(
    (await h.run("keep_subscription", { confirm: true, periodEnd: end }))
      .status,
    200,
  );
  assert.equal(h.calls.filter((c) => c.method === "PATCH").length, 0);
  for (const options of [
    { subscription: { status: "past_due" } },
    { subscription: { status: "canceled" } },
    {
      subscription: { current_billing_period: { ends_at: "2020-01-01" } },
      billing: { period_end: "2020-01-01" },
    },
    {
      subscription: {
        scheduled_change: { action: "pause", effective_at: end },
      },
    },
    { subscription: { customer_id: id("ctm", 2) } },
    { user: "crew" },
    { user: "hod" },
    { denied: true },
    { anonymous: true },
    { environment: "live" },
  ]) {
    const h = harness(options);
    assert.notEqual(
      (
        await h.run("keep_subscription", {
          confirm: true,
          periodEnd: options.billing?.period_end || end,
        })
      ).status,
      200,
    );
    assert.equal(h.calls.filter((c) => c.method === "PATCH").length, 0);
  }
});
test("keep subscription never retries ambiguous writes or trusts changed dates, plans or state", async () => {
  for (const options of [
    { keepTimeout: true },
    {
      keepResult: { scheduled_change: { action: "cancel", effective_at: end } },
    },
    { keepResult: { next_billed_at: "2030-03-01" } },
    { keepResult: { current_billing_period: { ends_at: "2030-03-01" } } },
    { keepResult: { customer_id: id("ctm", 2) } },
    { keepResult: { status: "canceled" } },
    { keepResult: { items: [{ quantity: 1, price: { id: id("pri", 8) } }] } },
  ]) {
    const h = harness({
      subscription: {
        scheduled_change: { action: "cancel", effective_at: end },
      },
      ...options,
    });
    const r = await h.run("keep_subscription", {
      confirm: true,
      periodEnd: end,
    });
    assert.notEqual(r.status, 200);
    assert.doesNotMatch(await r.text(), /private secret/);
    assert.equal(h.calls.filter((c) => c.method === "PATCH").length, 1);
    assert.equal(h.calls.filter((c) => c.name).length, 1);
  }
});
