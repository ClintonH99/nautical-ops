import test from "node:test";
import assert from "node:assert/strict";
import { processBillingEmails } from "../yachy-app/supabase/functions/_shared/billingEmailWorker.mjs";

const sub = "sub_" + "a".repeat(26),
  customer = "ctm_" + "a".repeat(26);
const now = Date.parse("2026-11-03T12:00:00Z");
function harness() {
  const prices = {};
  let n = 0;
  for (const tier of ["1_5", "6_10", "11_15", "16_25", "26_40", "40_plus"]) {
    prices[tier] = {};
    for (const period of ["monthly", "3_months", "6_months", "12_months"])
      prices[tier][period] = "pri_" + String(++n).padStart(26, "0");
  }
  const job = {
    subscription_id: sub,
    not_before: "2026-11-03T00:00:00Z",
    lease_id: "lease",
    attempts: 1,
  };
  const state = {
    paddle_subscription_links: [
      {
        subscription_id: sub,
        customer_id: customer,
        vessel_id: "vessel",
        checkout_id: "checkout",
        environment: "live",
      },
    ],
    vessel_subscriptions: [
      {
        vessel_id: "vessel",
        paddle_subscription_id: sub,
        paddle_customer_id: customer,
        plan_tier: "1_5",
        billing_period: "monthly",
      },
    ],
    paddle_checkout_intents: [
      {
        id: "checkout",
        user_id: "captain",
        vessel_id: "vessel",
        environment: "live",
      },
    ],
    users: [
      {
        id: "captain",
        role: "CAPTAIN_MOV",
        vessel_id: "vessel",
        email: "captain@example.com",
        name: "Test Captain",
      },
    ],
    vessels: [{ id: "vessel", name: "Example" }],
    billing_email_jobs: [job],
    billing_email_deliveries: [],
  };
  const subscription = {
    id: sub,
    customer_id: customer,
    status: "trialing",
    collection_mode: "automatic",
    current_billing_period: { ends_at: "2026-12-03T12:00:00Z" },
    items: [{ quantity: 1, price: { id: prices["1_5"].monthly } }],
  };
  let rejectEmail = false,
    rejectAccepted = false,
    hasMore = false,
    calls = [];
  const admin = {
    rpc: async () => ({ data: [{ ...job }], error: null }),
    from(table) {
      let action = "select",
        values,
        filters = [],
        single = false,
        returning = false;
      const query = {
        select() {
          returning = true;
          return query;
        },
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return query;
        },
        is(k, v) {
          filters.push((r) => (r[k] ?? null) === v);
          return query;
        },
        single() {
          single = true;
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        update(v) {
          action = "update";
          values = v;
          return query;
        },
        upsert(v) {
          action = "upsert";
          values = v;
          return query;
        },
        then(resolve) {
          let rows = state[table].filter((r) => filters.every((f) => f(r)));
          if (action === "upsert") {
            if (!state[table].some((r) => r.email_key === values.email_key))
              state[table].push({
                status: "pending",
                first_attempt_at: null,
                ...values,
              });
            rows = [];
          }
          if (action === "update") {
            if (rejectAccepted && values.status === "accepted")
              return Promise.resolve({
                data: null,
                error: { code: "test" },
              }).then(resolve);
            rows.forEach((r) => Object.assign(r, values));
          }
          return Promise.resolve({
            data: single
              ? structuredClone(rows[0])
              : structuredClone(returning ? rows : []),
            error: null,
          }).then(resolve);
        },
      };
      return query;
    },
  };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url === "https://api.resend.com/emails")
      return rejectEmail
        ? new Response("", { status: 429 })
        : Response.json({ id: "email-id" });
    assert.equal(options.method || "GET", "GET");
    if (url.includes("/subscriptions/"))
      return Response.json({ data: subscription });
    if (url.includes("/transactions?"))
      return Response.json({
        data: [],
        meta: { pagination: { has_more: hasMore } },
      });
    assert.fail("Unexpected network destination");
  };
  const getEnv = (k) =>
    ({
      PADDLE_ENV: "live",
      PADDLE_LIVE_API_KEY: "dummy",
      PADDLE_LIVE_PRICE_IDS: JSON.stringify(prices),
      RESEND_API_KEY: "dummy",
    })[k];
  return {
    state,
    subscription,
    calls,
    run: () => processBillingEmails({ admin, getEnv, fetcher, now: () => now }),
    rejectEmail: () => (rejectEmail = true),
    rejectAccepted: () => (rejectAccepted = true),
    hasMore: () => (hasMore = true),
  };
}
test("worker sends once, uses original captain and reads Paddle without writes", async () => {
  const h = harness();
  assert.equal((await h.run()).accepted, 1);
  const sent = h.calls.find((c) => c.url.includes("resend"));
  assert.equal(JSON.parse(sent.options.body).to, "captain@example.com");
  assert.equal((await h.run()).accepted, 0);
  assert.equal(h.calls.filter((c) => c.url.includes("resend")).length, 1);
});
test("provider rejection is retryable and never marked accepted", async () => {
  const h = harness();
  h.rejectEmail();
  assert.equal((await h.run()).failed, 1);
  assert.equal(h.state.billing_email_deliveries[0].status, "pending");
  assert.equal(h.state.billing_email_jobs[0].last_result, "retry");
});
test("database failure after send preserves stable payload and idempotency key for retry", async () => {
  const h = harness();
  h.rejectAccepted();
  await h.run();
  const first = h.calls.find((c) => c.url.includes("resend")).options;
  h.subscription.current_billing_period.ends_at = "2026-12-04T12:00:00Z";
  await h.run();
  const second = h.calls.filter((c) => c.url.includes("resend"))[1].options;
  assert.equal(first.body, second.body);
  assert.equal(
    first.headers["Idempotency-Key"],
    second.headers["Idempotency-Key"],
  );
});
test("pending trial is not sent after cancellation", async () => {
  const h = harness();
  h.rejectEmail();
  await h.run();
  h.subscription.status = "canceled";
  await h.run();
  assert.equal(h.calls.filter((c) => c.url.includes("resend")).length, 1);
  assert.equal(h.state.billing_email_deliveries[0].status, "review");
});
test("billing owner mismatch or incomplete provider history sends nothing", async () => {
  for (const mutate of [
    (h) => (h.state.users[0].vessel_id = "other"),
    (h) => h.hasMore(),
    (h) => (h.subscription.items[0].quantity = 2),
  ]) {
    const h = harness();
    mutate(h);
    assert.equal((await h.run()).failed, 1);
    assert.equal(h.calls.filter((c) => c.url.includes("resend")).length, 0);
  }
});
test("recipient email change does not redirect an earlier queued message", async () => {
  const h = harness();
  h.rejectEmail();
  await h.run();
  h.state.users[0].email = "changed@example.com";
  await h.run();
  assert.equal(h.calls.filter((c) => c.url.includes("resend")).length, 1);
  assert.equal(h.state.billing_email_deliveries[0].status, "review");
});
