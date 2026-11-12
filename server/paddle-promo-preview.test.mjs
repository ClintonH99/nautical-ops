import test from "node:test";
import assert from "node:assert/strict";
import { previewTrialPromo } from "../yachy-app/supabase/functions/_shared/paddlePromoPreview.mjs";
import { createPaddlePricingHandler } from "../yachy-app/supabase/functions/_shared/paddlePricing.mjs";
const id = (p) => p + "_" + "1".repeat(26);
const now = () => Date.parse("2030-01-01T00:00:00Z");
const end = "2030-02-01T00:00:00Z";
const price = {
  id: id("pri"),
  product_id: id("pro"),
  status: "active",
  unit_price: { amount: "7999", currency_code: "USD" },
  tax_mode: "external",
  billing_cycle: { interval: "month", frequency: 1 },
  trial_period: { interval: "day", frequency: 30 },
  quantity: { minimum: 1, maximum: 1 },
};
const body = {
  vesselId: "vessel",
  tier: "1_5",
  billingPeriod: "monthly",
  trialEnd: end,
  promoCode: "DEMO25",
};
const address = { country_code: "ZA" };
const config = {
  environment: "sandbox",
  base: "https://sandbox-api.paddle.com",
  apiKey: "fake",
  prices: { "1_5": { monthly: id("pri") } },
};
function setup({
  subscription = {},
  discount = {},
  data = {},
  line = {},
  totals = {},
  billing = {},
  rpcError = null,
} = {}) {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      assert.equal(name, "get_paddle_trial_billing");
      assert.deepEqual(args, { p_vessel_id: "vessel" });
      return {
        error: rpcError,
        data: {
          environment: "sandbox",
          subscription_id: id("sub"),
          customer_id: id("ctm"),
          plan_tier: "1_5",
          billing_period: "monthly",
          trial_end: end,
          ...billing,
        },
      };
    },
  };
  const fetcher = async (url, init) => {
    const method = init.method ?? "GET";
    calls.push({
      path: new URL(url).pathname,
      method,
      body: init.body && JSON.parse(init.body),
    });
    let response;
    if (url.includes("/subscriptions/"))
      response = {
        id: id("sub"),
        customer_id: id("ctm"),
        status: "trialing",
        collection_mode: "automatic",
        scheduled_change: null,
        current_billing_period: { ends_at: end },
        items: [{ price, quantity: 1 }],
        ...subscription,
      };
    else if (url.includes("/discounts?"))
      response = [
        {
          id: id("dsc"),
          code: "DEMO25",
          status: "active",
          enabled_for_checkout: true,
          usage_limit: 1,
          times_used: 0,
          expires_at: null,
          restrict_to: [id("pri")],
          recur: true,
          maximum_recurring_intervals: null,
          ...discount,
        },
      ];
    else {
      assert.equal(new URL(url).pathname, "/pricing-preview");
      assert.equal(method, "POST");
      assert.deepEqual(JSON.parse(init.body), {
        currency_code: "USD",
        address,
        discount_id: id("dsc"),
        items: [{ price_id: id("pri"), quantity: 1 }],
      });
      response = {
        currency_code: "USD",
        discount_id: id("dsc"),
        details: {
          line_items: [
            {
              price,
              quantity: 1,
              totals: {
                subtotal: "7999",
                discount: "2000",
                tax: "900",
                total: "6899",
                ...totals,
              },
              ...line,
            },
          ],
        },
        ...data,
      };
    }
    return Response.json({ data: response });
  };
  return {
    calls,
    run: (patch = {}) =>
      previewTrialPromo(
        config,
        client,
        { ...body, ...patch },
        address,
        fetcher,
        now,
      ),
  };
}
test("promo preview uses only read operations and Paddle-calculated discount/tax, never redeems", async () => {
  const h = setup();
  const result = await h.run();
  assert.deepEqual(result.quote, {
    tier: "1_5",
    baseCents: 7999,
    discountCents: 2000,
    taxCents: 900,
    totalCents: 6899,
  });
  assert.equal(result.expiresAt, "2030-01-01T00:05:00.000Z");
  assert.deepEqual(
    h.calls.map((c) => [c.path, c.method]),
    [
      ["/subscriptions/" + id("sub"), "GET"],
      ["/discounts", "GET"],
      ["/pricing-preview", "POST"],
    ],
  );
});
test("100 percent, one-payment and limited-duration promotions keep their actual terms", async () => {
  for (const discount of [
    { recur: false },
    { maximum_recurring_intervals: 3 },
    {},
  ]) {
    const h = setup({
      discount,
      totals: { discount: "7999", tax: "0", total: "0" },
    });
    const result = await h.run();
    assert.equal(result.quote.totalCents, 0);
    assert.equal(result.promo.recur, discount.recur ?? true);
    assert.equal(
      result.promo.maximumRecurringIntervals,
      discount.maximum_recurring_intervals ?? null,
    );
  }
});
test("invalid code, plan, ownership/device RPC failure, mismatched or expired trial stop before calculation", async () => {
  for (const options of [
    { rpcError: new Error("denied") },
    { billing: { environment: "live" } },
    { billing: { plan_tier: "6_10" } },
    { subscription: { customer_id: id("wrong") } },
    { subscription: { status: "active" } },
    { subscription: { scheduled_change: { action: "cancel" } } },
    { subscription: { current_billing_period: { ends_at: "2029-01-01" } } },
  ]) {
    const h = setup(options);
    await assert.rejects(h.run());
    assert.ok(!h.calls.some((c) => c.path === "/pricing-preview"));
  }
  for (const patch of [
    { promoCode: "" },
    { promoCode: "invalid&" },
    { tier: "other" },
    { trialEnd: "invalid" },
  ]) {
    const h = setup();
    await assert.rejects(h.run(patch));
    assert.equal(h.calls.length, 0);
  }
});
test("ineligible promotions cannot produce a success total", async () => {
  for (const discount of [
    { times_used: 1 },
    { expires_at: "2029-01-01" },
    { restrict_to: [] },
    { status: "archived" },
    { enabled_for_checkout: false },
    { recur: null },
    { maximum_recurring_intervals: 0 },
  ]) {
    const h = setup({ discount });
    await assert.rejects(h.run());
    assert.ok(!h.calls.some((c) => c.path === "/pricing-preview"));
  }
  const existing = setup({
    subscription: { discount: { id: id("dsc") } },
    discount: { times_used: 1 },
  });
  await existing.run(); // Existing attachment can be rechecked without another redemption.
});
test("malformed provider results never become a claimed discount or zero-tax success", async () => {
  for (const options of [
    { data: { currency_code: "EUR" } },
    { data: { discount_id: id("wrong") } },
    { data: { details: { line_items: [] } } },
    { line: { quantity: 2 } },
    { totals: { discount: "0" } },
    { totals: { discount: "8000" } },
    { totals: { tax: "0" } },
    { totals: { subtotal: "1" } },
    { totals: { total: "-1" } },
    { totals: { total: "9007199254740993" } },
  ])
    await assert.rejects(setup(options).run());
});
test("public pricing handler denies anonymous, crew and other-vessel promo requests before Paddle", async () => {
  for (const scenario of ["anonymous", "crew", "other-vessel"]) {
    let calls = 0;
    const handler = createPaddlePricingHandler({
      getEnv: (key) => (key === "PADDLE_PRICE_PREVIEW_ENABLED" ? "true" : ""),
      createClient: () => ({
        auth: {
          getUser: async () => ({
            data: { user: scenario === "anonymous" ? null : { id: "captain" } },
          }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  role: scenario === "crew" ? "CREW" : "CAPTAIN_MOV",
                  vessel_id: scenario === "other-vessel" ? "other" : "vessel",
                },
              }),
            }),
          }),
        }),
      }),
      fetcher: async () => {
        calls++;
        throw new Error("unexpected");
      },
    });
    const response = await handler(
      new Request("https://example.invalid", {
        method: "POST",
        headers: { authorization: "Bearer test" },
        body: JSON.stringify({ ...body, countryCode: "ZA" }),
      }),
    );
    assert.equal(response.status, scenario === "anonymous" ? 401 : 403);
    assert.equal(calls, 0);
  }
});
