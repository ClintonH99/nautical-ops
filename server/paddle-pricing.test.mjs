import test from "node:test";
import assert from "node:assert/strict";
import { approvedPrice } from "../yachy-app/supabase/functions/_shared/paddle.mjs";
import {
  billingLocation,
  previewPaddlePrices,
  createPaddlePricingHandler,
} from "../yachy-app/supabase/functions/_shared/paddlePricing.mjs";
const tiers = ["1_5", "6_10", "11_15", "16_25", "26_40", "40_plus"];
const periods = ["monthly", "3_months", "6_months", "12_months"];
const prices = Object.fromEntries(
  tiers.map((t, i) => [
    t,
    Object.fromEntries(
      periods.map((p, j) => [p, `pri_${String(i * 4 + j).padStart(26, "0")}`]),
    ),
  ]),
);
const config = {
  prices,
  environment: "sandbox",
  base: "https://sandbox-api.paddle.com",
  apiKey: "secret",
};
function fixture(period = "monthly", rate = 0.2) {
  return {
    currency_code: "USD",
    details: {
      line_items: tiers.map((t) => {
        const p = approvedPrice(t, period),
          tax = Math.round(Number(p.amount) * rate);
        return {
          quantity: 1,
          price: {
            id: prices[t][period],
            status: "active",
            tax_mode: "external",
            unit_price: { currency_code: "USD", amount: p.amount },
            billing_cycle: { interval: "month", frequency: p.months },
            trial_period: { interval: "day", frequency: 30 },
            quantity: { minimum: 1, maximum: 1 },
          },
          totals: {
            subtotal: p.amount,
            tax: String(tax),
            total: String(Number(p.amount) + tax),
            discount: "0",
          },
        };
      }),
    },
  };
}
test("all 24 base prices remain unchanged across provider tax scenarios", async () => {
  for (const period of periods)
    for (const rate of [0, 0.085, 0.19, 0.2, 0.27]) {
      const result = await previewPaddlePrices(
        config,
        period,
        { country_code: "FR" },
        async (_url, options) => {
          const body = JSON.parse(options.body);
          assert.equal(body.currency_code, "USD");
          assert.equal(body.items.length, 6);
          assert.deepEqual(body.address, { country_code: "FR" });
          assert.equal(body.customer_ip_address, undefined);
          return Response.json({ data: fixture(period, rate) });
        },
      );
      assert.equal(
        result[0].baseCents,
        Number(approvedPrice("1_5", period).amount),
      );
      assert.equal(
        result[0].totalCents,
        result[0].baseCents + Math.round(result[0].baseCents * rate),
      );
    }
});
test("rejects missing, duplicate, discounted, tax-inclusive and inconsistent provider results", async () => {
  for (const mutate of [
    (d) => d.details.line_items.pop(),
    (d) => (d.details.line_items[1] = d.details.line_items[0]),
    (d) => (d.currency_code = "EUR"),
    (d) => (d.details.line_items[0].price.tax_mode = "internal"),
    (d) => (d.details.line_items[0].totals.discount = "1"),
    (d) => (d.details.line_items[0].totals.tax = "-1"),
    (d) => (d.details.line_items[0].totals.total = "1"),
    (d) => (d.details.line_items[0].price.unit_price_overrides = [{}]),
  ]) {
    const d = fixture();
    mutate(d);
    await assert.rejects(
      previewPaddlePrices(config, "monthly", { country_code: "FR" }, async () =>
        Response.json({ data: d }),
      ),
    );
  }
});
test("billing location requires all Paddle mandatory postal codes", () => {
  for (const countryCode of ["AU", "CA", "DE", "ES", "FR", "GB", "IN", "IT", "NL", "US"])
    assert.throws(() => billingLocation({ countryCode }));
  assert.deepEqual(billingLocation({ countryCode: "ZA" }), {
    country_code: "ZA",
  });
  assert.deepEqual(
    billingLocation({ countryCode: "US", postalCode: " 10001 " }),
    { country_code: "US", postal_code: "10001" },
  );
  for (const value of [
    null,
    {},
    { countryCode: "France" },
    { countryCode: "US" },
    { countryCode: "CA" },
    { countryCode: "FR", postalCode: "x".repeat(33) },
  ])
    assert.throws(() => billingLocation(value));
});
test("preview endpoint enforces authentication, role, vessel and disabled configuration without writes", async () => {
  for (const scenario of [
    "disabled",
    "anonymous",
    "crew",
    "wrong-vessel",
    "ok",
  ]) {
    let calls = 0;
    const env = {
      PADDLE_PRICE_PREVIEW_ENABLED: scenario === "disabled" ? "false" : "true",
      PADDLE_ENV: "sandbox",
      PADDLE_SANDBOX_API_KEY: "secret",
      PADDLE_PRICE_IDS: JSON.stringify(prices),
    };
    const handler = createPaddlePricingHandler({
      getEnv: (k) => env[k],
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
                  vessel_id: scenario === "wrong-vessel" ? "other" : "vessel",
                },
              }),
            }),
          }),
        }),
      }),
      fetcher: async () => {
        calls++;
        return Response.json({ data: fixture() });
      },
    });
    const response = await handler(
      new Request("https://example.com", {
        method: "POST",
        headers: { authorization: "Bearer valid" },
        body: JSON.stringify({
          vesselId: "vessel",
          billingPeriod: "monthly",
          countryCode: "FR",
          postalCode: "75001",
        }),
      }),
    );
    assert.equal(
      response.status,
      scenario === "ok"
        ? 200
        : scenario === "disabled"
          ? 503
          : scenario === "anonymous"
            ? 401
            : 403,
    );
    assert.equal(calls, scenario === "ok" ? 1 : 0);
    assert.doesNotMatch(await response.text(), /secret|apiKey/);
  }
});
