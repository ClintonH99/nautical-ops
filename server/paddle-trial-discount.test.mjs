import test from "node:test";
import assert from "node:assert/strict";
import { applyTrialDiscount } from "../yachy-app/supabase/functions/_shared/paddleTrialDiscount.mjs";
const id = (p) => p + "_" + "1".repeat(26);
const config = { base: "https://sandbox-api.paddle.com", apiKey: "fake" };
const sub = {
  id: id("sub"),
  customer_id: id("ctm"),
  status: "trialing",
  collection_mode: "automatic",
  current_billing_period: { ends_at: "2030-02-01T00:00:00Z" },
  next_billed_at: null,
  scheduled_change: null,
  items: [{ price: { id: id("pri"), product_id: id("pro") }, quantity: 1 }],
};
const discount = {
  id: id("dsc"),
  code: "VQ72100",
  status: "active",
  enabled_for_checkout: true,
  restrict_to: [id("pri")],
  usage_limit: 1,
  times_used: 0,
  expires_at: null,
};
function setup({ d = {}, s = {}, updated = {}, fail = false } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({
      url,
      method: init.method || "GET",
      body: init.body && JSON.parse(init.body),
    });
    if (init.method === "PATCH") {
      if (fail) throw new Error("timeout");
      return Response.json({
        data: { ...sub, ...s, discount: { id: discount.id }, ...updated },
      });
    }
    return Response.json({ data: [{ ...discount, ...d }] });
  };
  return {
    calls,
    run: (code = "VQ72100") =>
      applyTrialDiscount(config, { ...sub, ...s }, code, fetcher, () =>
        Date.parse("2030-01-01"),
      ),
  };
}
test("trial promo updates only discount, without billing, customer, items or date changes", async () => {
  const h = setup();
  await h.run();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].body, {
    discount: { id: id("dsc"), effective_from: "next_billing_period" },
    proration_billing_mode: "do_not_bill",
  });
});
test("empty code performs no provider operation", async () => {
  const h = setup();
  await h.run("");
  assert.equal(h.calls.length, 0);
});
test("invalid code is rejected before provider lookup", async () => {
  for (const code of ["x&y", {}, "a".repeat(33)]) {
    const h = setup();
    await assert.rejects(h.run(code));
    assert.equal(h.calls.length, 0);
  }
});
test("ineligible, exhausted, expired and private discounts cannot mutate a subscription", async () => {
  for (const d of [
    { restrict_to: [] },
    { restrict_to: [id("pro") + "x"] },
    { times_used: 1 },
    { expires_at: "2029-01-01" },
    { expires_at: "invalid" },
    { status: "archived" },
    { enabled_for_checkout: false },
    { code: "different" },
  ]) {
    const h = setup({ d });
    await assert.rejects(h.run());
    assert.equal(h.calls.length, 1);
  }
});
test("same attached code retries without consuming another redemption or PATCH", async () => {
  const h = setup({ s: { discount: { id: id("dsc") } }, d: { times_used: 1 } });
  await h.run();
  assert.equal(h.calls.length, 1);
});
test("different existing promotion is not overwritten", async () => {
  const h = setup({ s: { discount: { id: "dsc_" + "2".repeat(26) } } });
  await assert.rejects(h.run());
  assert.equal(h.calls.length, 1);
});
test("ambiguous provider mutation is never retried automatically", async () => {
  const h = setup({ fail: true });
  await assert.rejects(h.run());
  assert.equal(h.calls.length, 2);
});
test("post-update identity, trial dates, quantity and discount are reverified", async () => {
  for (const updated of [
    { status: "active" },
    { customer_id: "wrong" },
    { id: "wrong" },
    { current_billing_period: { ends_at: "2030-03-01" } },
    { next_billed_at: "2030-01-01" },
    { items: [] },
    { discount: null },
    { scheduled_change: { action: "cancel" } },
  ]) {
    const h = setup({ updated });
    await assert.rejects(h.run());
  }
});
