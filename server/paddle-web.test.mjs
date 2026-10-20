import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../yachy-app/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");
const html = fs.readFileSync(
  new URL("../yachy-app/public/checkout.html", import.meta.url),
  "utf8",
);
import {
  publicPaddleConfig,
  publicPaddleScript,
} from "../yachy-app/scripts/paddle-web-config.mjs";

test("browser configuration is disabled by default and never emits server secrets", () => {
  const env = {
    PADDLE_LIVE_API_KEY: "private-key",
    PADDLE_WEBHOOK_SECRET: "private-secret",
  };
  assert.deepEqual(publicPaddleConfig(env), { enabled: false });
  assert.doesNotMatch(publicPaddleScript(env), /private/);
});
test("enabled browser configuration requires a public token for the exact environment", () => {
  const env = {
    EXPO_PUBLIC_PADDLE_CHECKOUT_ENABLED: "true",
    EXPO_PUBLIC_PADDLE_ENV: "sandbox",
    EXPO_PUBLIC_PADDLE_CLIENT_TOKEN: "test_abc123",
  };
  assert.deepEqual(publicPaddleConfig(env), {
    enabled: true,
    environment: "sandbox",
    token: "test_abc123",
  });
  for (const patch of [
    { EXPO_PUBLIC_PADDLE_ENV: "production" },
    { EXPO_PUBLIC_PADDLE_CLIENT_TOKEN: "live_abc" },
    { EXPO_PUBLIC_PADDLE_CLIENT_TOKEN: "pdl_sdbx_apikey_secret" },
    { EXPO_PUBLIC_PADDLE_CLIENT_TOKEN: "test_</script>" },
  ])
    assert.throws(() => publicPaddleConfig({ ...env, ...patch }));
});
test("sandbox trial switch cannot activate live checkout", () => {
  const env = {
    EXPO_PUBLIC_PADDLE_SANDBOX_TRIAL_ENABLED: "true",
    EXPO_PUBLIC_PADDLE_ENV: "live",
    EXPO_PUBLIC_PADDLE_CLIENT_TOKEN: "live_abc",
  };
  assert.deepEqual(publicPaddleConfig(env), { enabled: false });
  assert.equal(
    publicPaddleConfig({
      ...env,
      EXPO_PUBLIC_PADDLE_ENV: "sandbox",
      EXPO_PUBLIC_PADDLE_CLIENT_TOKEN: "test_abc",
    }).enabled,
    true,
  );
});
test("live public checkout requires both independent switches and a live token", () => {
  const env = {
    EXPO_PUBLIC_PADDLE_ENV: "live",
    EXPO_PUBLIC_PADDLE_CLIENT_TOKEN: "live_testtoken",
    EXPO_PUBLIC_PADDLE_CHECKOUT_ENABLED: "true",
  };
  assert.deepEqual(publicPaddleConfig(env), { enabled: false });
  assert.deepEqual(
    publicPaddleConfig({
      ...env,
      EXPO_PUBLIC_PADDLE_LIVE_BILLING_ENABLED: "true",
    }),
    { enabled: true, environment: "live", token: "live_testtoken" },
  );
  assert.throws(() =>
    publicPaddleConfig({
      ...env,
      EXPO_PUBLIC_PADDLE_LIVE_BILLING_ENABLED: "true",
      EXPO_PUBLIC_PADDLE_CLIENT_TOKEN: "test_wrong",
    }),
  );
});
const source = fs.readFileSync(
  new URL("../yachy-app/public/paddle-checkout.js", import.meta.url),
  "utf8",
);
function checkoutPage(
  config,
  transaction = `txn_${"1".repeat(26)}`,
  options = {},
) {
  const dom = new JSDOM(html);
  const nodes = new Proxy(
    {},
    { get: (_, id) => dom.window.document.getElementById(id) },
  );
  const scripts = [];
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  const win = {
    NAUTICAL_PADDLE: config,
    location: { search: options.search || `?_ptxn=${transaction}` },
    setTimeout: (callback) => {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    sessionStorage: {
      getItem: (key) => {
        if (options.storageError) throw new Error("Storage blocked");
        return JSON.stringify(
          key.startsWith("paddle-trial-summary:")
            ? options.trialSummary || null
            : options.prefill || null,
        );
      },
      removeItem: (key) => calls.push({ removed: key }),
    },
    Paddle: {
      Environment: { set: (env) => calls.push(env) },
      Initialize: (settings) => calls.push(settings),
      Checkout: {
        open: (settings) => calls.push({ opened: settings }),
        updateCheckout: (settings) => {
          if (options.updateError) throw new Error("Provider unavailable");
          calls.push({ updated: settings });
        },
      },
    },
  };
  vm.runInNewContext(source, {
    URLSearchParams,
    window: win,
    document: {
      getElementById: (id) => nodes[id],
      createElement: (name) => dom.window.document.createElement(name),
      head: { appendChild: (s) => scripts.push(s) },
    },
  });
  return { nodes, scripts, calls, timers, document: dom.window.document };
}
test("unconfigured and malformed checkouts do not load Paddle", () => {
  for (const [config, transaction] of [
    [undefined],
    [{ enabled: false }],
    [{ enabled: true, environment: "sandbox", token: "live_abc" }],
    [{ enabled: true, environment: "sandbox", token: "test_abc" }, "bad"],
  ]) {
    assert.equal(checkoutPage(config, transaction).scripts.length, 0);
  }
});

test("explicit checkout carries a recent billing address to Paddle exactly once", () => {
  const transaction = `txn_${"1".repeat(26)}`;
  const page = checkoutPage(
    { enabled: true, environment: "sandbox", token: "test_abc" },
    transaction,
    {
      search: `?transaction=${transaction}`,
      prefill: {
        email: "test@example.com",
        address: { countryCode: "FR", postalCode: "75001" },
        savedAt: Date.now(),
      },
    },
  );
  page.scripts[0].onload();
  const opened = page.calls.filter((call) => call.opened);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].opened.transactionId, transaction);
  assert.equal(opened[0].opened.customer.address.countryCode, "FR");
  assert.equal(opened[0].opened.customer.address.postalCode, "75001");
  assert.equal(opened[0].opened.customer.email, "test@example.com");
  assert.equal(page.calls.filter((call) => call.removed).length, 1);
  assert.equal(opened[0].opened.items, undefined);
});

test("expired or malformed address prefill never prevents secure checkout", () => {
  const transaction = `txn_${"1".repeat(26)}`;
  for (const prefill of [
    null,
    {
      email: "test@example.com",
      address: { countryCode: "FR", postalCode: "75001" },
      savedAt: Date.now() - 600001,
    },
    {
      email: "invalid",
      address: { countryCode: "FR", postalCode: "75001" },
      savedAt: Date.now(),
    },
  ]) {
    const page = checkoutPage(
      { enabled: true, environment: "sandbox", token: "test_abc" },
      transaction,
      {
        search: `?transaction=${transaction}`,
        prefill,
      },
    );
    page.scripts[0].onload();
    const opened = page.calls.filter((call) => call.opened);
    assert.equal(opened.length, 1);
    assert.equal(opened[0].opened.customer, undefined);
  }
});

test("conflicting checkout parameters cannot open duplicate payment windows", () => {
  const transaction = `txn_${"1".repeat(26)}`;
  for (const search of [
    `?transaction=${transaction}&_ptxn=${transaction}`,
    `?transaction=${transaction}&transaction=${transaction}`,
  ]) {
    const page = checkoutPage(
      { enabled: true, environment: "sandbox", token: "test_abc" },
      transaction,
      { search },
    );
    assert.equal(page.scripts.length, 0);
    assert.match(page.nodes.status.textContent, /invalid/);
  }
});
test("sandbox checkout initializes once and never treats checkout completion as entitlement", () => {
  const page = checkoutPage({
    enabled: true,
    environment: "sandbox",
    token: "test_abc",
  });
  assert.equal(
    page.scripts[0].src,
    "https://cdn.paddle.com/paddle/v2/paddle.js",
  );
  page.scripts[0].onload();
  assert.equal(page.calls[0], "sandbox");
  assert.equal(page.calls[1].checkout.settings.variant, "one-page");
  assert.equal(
    page.calls[1].checkout.settings.showNonExpressPaymentMethods,
    undefined,
  );
  assert.equal(page.calls[1].checkout.settings.displayMode, "inline");
  assert.equal(
    page.calls[1].checkout.settings.frameTarget,
    "checkout-container",
  );
  assert.equal(page.calls[1].checkout.settings.theme, "light");
  assert.equal(page.calls.filter((call) => call.opened).length, 0); // _ptxn auto-open only
  assert.equal(page.nodes.environment.hidden, false);
  page.calls[1].eventCallback({ name: "checkout.completed" });
  assert.equal(page.nodes["success-panel"].hidden, true);
  assert.match(page.nodes.status.textContent, /confirmation is incomplete/);
  page.calls[1].eventCallback({ name: "checkout.closed" });
  assert.match(page.nodes.status.textContent, /closed/);
});
test("Paddle load failures present a recoverable error instead of a blank screen", () => {
  const page = checkoutPage({
    enabled: true,
    environment: "live",
    token: "live_abc",
  });
  page.scripts[0].onerror();
  assert.match(page.nodes.status.textContent, /could not load/);
  assert.equal(page.nodes.environment.hidden, true);
});

const txn = `txn_${"1".repeat(26)}`;
const eventData = (patch = {}) => ({
  transaction_id: txn,
  status: "ready",
  currency_code: "USD",
  items: [
    {
      product: { name: "Nautical Ops 6–10 Crew Members" },
      quantity: 1,
      billing_cycle: { interval: "month", frequency: 1 },
      trial_period: { interval: "day", frequency: 30 },
    },
  ],
  totals: { subtotal: 0, tax: 0, total: 0, balance: 0 },
  recurring_totals: { subtotal: 89.99, tax: 7.1, total: 97.09 },
  ...patch,
});
function loadedPage(options = {}) {
  const page = checkoutPage(
    { enabled: true, environment: "sandbox", token: "test_abc" },
    txn,
    options,
  );
  page.scripts[0].onload();
  page.event = (name, data = eventData()) =>
    page.calls.find((call) => call.eventCallback).eventCallback({ name, data });
  return page;
}
test("summary uses Paddle major units, tax and dates, not the illustrative mockup prices", () => {
  const trialEnd = new Date(Date.now() + 20 * 86400000).toISOString();
  const page = loadedPage({ trialSummary: { trialEnd, savedAt: Date.now() } });
  page.event("checkout.loaded");
  assert.match(page.nodes["due-today"].textContent, /USD\s+0\.00/);
  assert.match(
    page.nodes["recurring-total"].textContent,
    /USD\s+97\.09 · every month/,
  );
  assert.match(page.nodes["recurring-tax"].textContent, /7\.10/);
  assert.equal(
    page.nodes["first-payment"].textContent,
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(trialEnd)),
  );
  assert.equal(page.nodes["trial-badge"].textContent, "Existing free trial");
  assert.equal(page.nodes["payment-frame"].style.visibility, "visible");
  assert.equal(page.nodes["status-panel"].hidden, true);
  assert.equal(page.timers.size, 0);
  page.event(
    "checkout.customer.updated",
    eventData({
      recurring_totals: { subtotal: 89.99, tax: 18, total: 107.99 },
    }),
  );
  assert.match(page.nodes["recurring-total"].textContent, /107\.99/);
});
test("missing or stale trial context never invents a fresh trial end date", () => {
  for (const options of [
    {},
    { storageError: true },
    { trialSummary: { trialEnd: "2030-01-01", savedAt: Date.now() - 600001 } },
  ]) {
    const page = loadedPage(options);
    page.event("checkout.loaded");
    assert.equal(page.nodes["first-payment"].textContent, "See payment form");
    assert.equal(page.nodes["first-payment-row"].hidden, true);
    assert.equal(page.nodes["trial-badge"].hidden, true);
    assert.equal(page.nodes["trial-note"].hidden, true);
    assert.equal(page.nodes["payment-frame"].style.visibility, "visible");
  }
});
test("malformed and missing totals never look like zero tax or retain stale payable amounts", () => {
  for (const patch of [
    { totals: null },
    { recurring_totals: null },
    { recurring_totals: { subtotal: 89.99, total: 89.99 } },
    { currency_code: "invalid" },
    { items: [] },
    { totals: { subtotal: 0, tax: NaN, total: 0 } },
  ]) {
    const page = loadedPage();
    page.event("checkout.loaded");
    page.event("checkout.updated", eventData(patch));
    assert.equal(page.nodes["summary-details"].hidden, true);
    assert.equal(page.nodes["payment-frame"].style.visibility, "hidden");
    assert.equal(page.nodes.retry.hidden, false);
    assert.match(page.nodes.status.textContent, /could not be confirmed/);
  }
});
test("other transaction and unknown events cannot replace this checkout's summary", () => {
  const page = loadedPage();
  page.event("checkout.loaded");
  const total = page.nodes["recurring-total"].textContent;
  page.event(
    "checkout.updated",
    eventData({ transaction_id: `txn_${"2".repeat(26)}` }),
  );
  page.event("unknown.event", {});
  assert.equal(page.nodes["recurring-total"].textContent, total);
});
test("annual, quarterly and one-time payments do not inherit monthly trial copy", () => {
  for (const cycle of [
    { interval: "year", frequency: 1 },
    { interval: "month", frequency: 3 },
    null,
  ]) {
    const page = loadedPage();
    page.event(
      "checkout.loaded",
      eventData({
        items: [
          {
            product: { name: "Vessel plan" },
            quantity: 1,
            billing_cycle: cycle,
          },
        ],
        totals: { subtotal: 259.99, tax: 52, total: 311.99 },
      }),
    );
    assert.equal(page.nodes["trial-badge"].hidden, true);
    assert.equal(page.nodes["first-payment-row"].hidden, true);
    assert.equal(page.nodes["recurring-section"].hidden, !cycle);
    assert.match(page.nodes["due-today"].textContent, /311\.99/);
    assert.doesNotMatch(
      page.nodes["payment-note"].textContent,
      /No subscription payment today/,
    );
    if (cycle)
      assert.match(
        page.nodes["recurring-total"].textContent,
        new RegExp(cycle.frequency === 3 ? "every 3 months" : "every year"),
      );
  }
});
test("discounts, quantities and credits remain explicit and provider text is not rendered as HTML", () => {
  const page = loadedPage();
  page.event(
    "checkout.loaded",
    eventData({
      items: [
        { product: { name: "<img src=x onerror=alert(1)>" }, quantity: 2 },
      ],
      totals: {
        subtotal: 100,
        tax: 18,
        discount: 10,
        total: 108,
        credit: 8,
        balance: 100,
      },
    }),
  );
  assert.equal(page.nodes["plan-items"].querySelector("img"), null);
  assert.match(page.nodes["plan-items"].textContent, /Quantity: 2/);
  assert.equal(page.nodes["credit-row"].hidden, false);
  assert.equal(page.nodes["discount-row"].hidden, false);
  assert.match(page.nodes["due-today"].textContent, /100\.00/);
});
test("slow checkout loading offers a reload without automatically creating another transaction", () => {
  const page = loadedPage({ search: `?transaction=${txn}` });
  page.timers.get(1)();
  assert.match(page.nodes.status.textContent, /taking longer/);
  assert.equal(page.nodes.retry.hidden, false);
  assert.equal(page.calls.filter((call) => call.opened).length, 1);
  page.event("checkout.loaded");
  assert.equal(page.nodes["status-panel"].hidden, true);
});
test("declined payment and completion have visible actions without granting app access", () => {
  const page = loadedPage();
  page.event("checkout.payment.failed");
  assert.match(page.nodes.status.textContent, /could not be completed/);
  page.event("checkout.completed", eventData({ status: "completed" }));
  assert.equal(page.nodes["success-panel"].hidden, false);
  assert.match(page.nodes["success-message"].textContent, /server-confirmed/);
  assert.equal(page.calls.filter((call) => call.opened).length, 0);
});
test("branded page has no first-party card inputs and keeps provider frame plus refund link", () => {
  const page = loadedPage();
  assert.equal(page.document.querySelectorAll("input").length, 1);
  assert.equal(page.document.querySelector("input").id, "promo-code");
  assert.equal(page.document.querySelectorAll("form").length, 1);
  assert.equal(page.document.querySelector("form").id, "promo-form");
  assert.equal(
    page.document.querySelector("img").getAttribute("src"),
    "/nautical-ops-icon-192.png",
  );
  assert.ok(page.document.querySelector(".checkout-container"));
  assert.ok(page.document.querySelector('a[href="/refund-policy"]'));
  assert.doesNotMatch(html, /overflow:\s*hidden|max-height:/);
  assert.match(html, /max-width: 960px/);
  assert.match(html, /color-scheme: light;/);
  assert.doesNotMatch(
    html,
    /prefers-color-scheme:\s*dark|color-scheme:\s*light dark/,
  );
  assert.match(html, /body\s*\{[^}]*background:\s*#fff;/);
  assert.equal(page.calls[1].checkout.settings.theme, "light");
});

function applyPromo(page, code) {
  page.nodes["promo-code"].value = code;
  page.nodes["promo-form"].dispatchEvent(
    new page.document.defaultView.Event("submit", { cancelable: true }),
  );
}
test("promo codes are sent to Paddle only after checkout loads; blank codes are rejected locally", () => {
  const page = loadedPage();
  applyPromo(page, "DEMO");
  assert.equal(page.calls.filter((call) => call.updated).length, 0);
  page.event("checkout.loaded");
  applyPromo(page, "   ");
  assert.match(page.nodes["promo-message"].textContent, /Enter a promo/);
  assert.equal(page.calls.filter((call) => call.updated).length, 0);
  applyPromo(page, " DEMO ");
  applyPromo(page, "DUPLICATE");
  const calls = page.calls.filter((call) => call.updated);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].updated.discountCode, "DEMO");
  assert.deepEqual(Object.keys(calls[0].updated), ["discountCode"]);
});
test("promo success requires matching provider discount and totals, not unrelated or stale events", () => {
  const page = loadedPage();
  page.event("checkout.loaded");
  applyPromo(page, "DEMO");
  assert.equal(page.nodes["payment-frame"].style.visibility, "hidden");
  page.event("checkout.customer.updated");
  assert.equal(page.nodes["promo-apply"].disabled, true);
  assert.equal(page.nodes["payment-frame"].style.visibility, "hidden");
  assert.doesNotMatch(page.nodes["promo-message"].textContent, /applied/);
  page.event(
    "checkout.discount.applied",
    eventData({
      discount: { id: "dsc_example", code: "DEMO" },
      recurring_totals: { subtotal: 89.99, discount: 9, tax: 0, total: 80.99 },
    }),
  );
  assert.match(page.nodes["promo-message"].textContent, /Code DEMO applied/);
  assert.match(page.nodes["recurring-total"].textContent, /80\.99/);
  assert.equal(page.nodes["promo-apply"].disabled, false);
  assert.equal(page.nodes["payment-frame"].style.visibility, "visible");
  assert.equal(page.nodes["promo-remove"].hidden, false);
  assert.equal(page.timers.size, 0);
});
test("removal waits for provider confirmation and restores undiscounted provider totals", () => {
  const page = loadedPage();
  const discounted = eventData({
    discount: { code: "DEMO", id: "dsc_example" },
    recurring_totals: { subtotal: 89.99, discount: 9, tax: 0, total: 80.99 },
  });
  page.event("checkout.loaded", discounted);
  page.nodes["promo-remove"].click();
  assert.equal(
    page.calls.filter((call) => call.updated)[0].updated.discountCode,
    null,
  );
  page.event("checkout.updated", discounted);
  assert.equal(page.nodes["promo-apply"].disabled, true);
  page.event("checkout.discount.removed");
  assert.equal(page.nodes["promo-remove"].hidden, true);
  assert.equal(page.nodes["promo-code"].value, "");
  assert.match(page.nodes["recurring-total"].textContent, /97\.09/);
  assert.equal(page.nodes["payment-frame"].style.visibility, "visible");
});
test("a recognized code with no provider-calculated saving never promises a discounted first payment", () => {
  const page = loadedPage();
  page.event("checkout.loaded");
  applyPromo(page, "DEMO");
  page.event(
    "checkout.updated",
    eventData({ discount: { id: "dsc_example", code: "DEMO" } }),
  );
  assert.match(
    page.nodes["promo-message"].textContent,
    /first-payment discount has not been confirmed/,
  );
  assert.equal(page.nodes["promo-message"].dataset.state, "error");
  assert.doesNotMatch(
    page.nodes["promo-message"].textContent,
    /Code DEMO applied/,
  );
  assert.match(page.nodes["recurring-total"].textContent, /97\.09/);
});
test("provider warning and error stop checking without falsely claiming a discount or unblocking payment", () => {
  for (const event of ["checkout.warning", "checkout.error"]) {
    const page = loadedPage();
    page.event("checkout.loaded");
    applyPromo(page, "INVALID");
    page.event(event);
    assert.doesNotMatch(page.nodes["promo-message"].textContent, /Checking/);
    assert.match(page.nodes["promo-message"].textContent, /Reload/);
    assert.equal(page.nodes["promo-apply"].disabled, true);
    assert.equal(page.nodes["payment-frame"].style.visibility, "hidden");
    assert.equal(page.timers.size, 0);
    page.event("checkout.updated");
    assert.equal(page.nodes["payment-frame"].style.visibility, "hidden");
  }
});
test("promo timeout and SDK exception provide recovery and cannot be overwritten by late events", () => {
  for (const updateError of [false, true]) {
    const page = loadedPage({ updateError });
    page.event("checkout.loaded");
    applyPromo(page, "DEMO");
    if (!updateError) [...page.timers.values()][0]();
    assert.match(page.nodes["promo-message"].textContent, /Reload/);
    assert.equal(page.nodes.retry.hidden, false);
    page.event("checkout.updated");
    assert.equal(page.nodes["promo-apply"].disabled, true);
    assert.equal(page.nodes["payment-frame"].style.visibility, "hidden");
  }
});
test("completed and closed checkouts cannot accept further promo edits from late events", () => {
  for (const event of ["checkout.completed", "checkout.closed"]) {
    const page = loadedPage();
    page.event("checkout.loaded");
    page.event(event, eventData({ status: "completed" }));
    page.event("checkout.updated");
    applyPromo(page, "DEMO");
    assert.equal(page.nodes["promo-apply"].disabled, true);
    assert.equal(page.calls.filter((call) => call.updated).length, 0);
  }
});

test("payment-method checkout is compact and never invents a trial", () => {
  const page = loadedPage({
    search: `?transaction=${txn}&flow=payment-method`,
  });
  page.event("checkout.loaded");
  assert.equal(page.nodes["page-title"].textContent, "Update payment method");
  assert.equal(page.nodes["checkout-grid"].dataset.flow, "payment-method");
  assert.equal(page.nodes["promo-section"].hidden, true);
  assert.equal(page.nodes["trial-badge"].hidden, true);
  assert.equal(page.nodes["trial-note"].hidden, true);
  assert.equal(page.nodes["recurring-section"].hidden, false);
  assert.match(page.nodes["payment-note"].textContent, /existing subscription/);
  applyPromo(page, "IGNORED");
  assert.equal(page.calls.filter((call) => call.updated).length, 0);
});

test("a display hint cannot hide an outstanding amount or invent zero-charge update copy", () => {
  const page = loadedPage({
    search: `?transaction=${txn}&flow=payment-method`,
  });
  page.event(
    "checkout.loaded",
    eventData({
      totals: {
        subtotal: 89.99,
        tax: 0,
        total: 89.99,
        balance: 0.7,
        credit: 89.29,
      },
    }),
  );
  assert.equal(page.nodes["page-title"].textContent, "Set up billing details");
  assert.match(page.nodes["due-today"].textContent, /0\.70/);
  assert.equal(page.nodes["credit-row"].hidden, false);
  assert.equal(page.nodes["update-note"].hidden, true);
  assert.doesNotMatch(
    page.nodes["payment-note"].textContent,
    /No payment is due/,
  );
});

test("existing trial setup keeps the verified original date with supported payment setup", () => {
  const trialEnd = new Date(Date.now() + 7 * 86400000).toISOString();
  const page = loadedPage({
    search: `?transaction=${txn}&flow=payment-method`,
    trialSummary: { trialEnd, savedAt: Date.now() },
  });
  page.event("checkout.loaded");
  assert.equal(page.nodes["trial-badge"].hidden, false);
  assert.match(
    page.nodes["trial-note"].textContent,
    /existing trial end date stays the same/,
  );
  assert.doesNotMatch(page.nodes["trial-badge"].textContent, /30/);
});

test("only matching completed events show confirmation, with actual wallet type and no access claim", () => {
  for (const [type, label] of [
    ["apple_pay", "Apple Pay"],
    ["google_pay", "Google Pay"],
    ["card", "Card"],
    ["unknown", ""],
  ]) {
    const page = loadedPage({
      search: `?transaction=${txn}&flow=payment-method`,
    });
    page.event("checkout.loaded");
    for (const data of [
      {},
      eventData(),
      eventData({
        status: "completed",
        transaction_id: `txn_${"2".repeat(26)}`,
      }),
    ]) {
      page.event("checkout.completed", data);
      assert.equal(page.nodes["success-panel"].hidden, true);
    }
    page.event(
      "checkout.completed",
      eventData({ status: "completed", payment: { method_details: { type } } }),
    );
    assert.equal(page.nodes["success-panel"].hidden, false);
    assert.equal(
      page.nodes["success-title"].textContent,
      "Payment method updated",
    );
    assert.equal(page.nodes["success-method"].textContent, label);
    assert.equal(page.nodes["success-method"].hidden, !label);
    assert.doesNotMatch(
      page.nodes["success-message"].textContent,
      /remains active|access restored/,
    );
    assert.equal(page.nodes["checkout-grid"].hidden, true);
    assert.equal(page.document.activeElement.id, "success-title");
    page.event("checkout.closed");
    page.event("checkout.payment.failed");
    assert.equal(page.nodes["success-panel"].hidden, false);
    assert.equal(page.nodes["status-panel"].hidden, true);
  }
});

test("Apple Pay association artifact is present and copied with its required directory", () => {
  const association = fs.readFileSync(
    new URL(
      "../yachy-app/public/.well-known/apple-developer-merchantid-domain-association",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(association.trim(), /^[A-Fa-f0-9]+$/);
  const payload = JSON.parse(Buffer.from(association.trim(), "hex").toString());
  assert.ok(payload.pspId && payload.signature);
  const build = fs.readFileSync(
    new URL("../yachy-app/scripts/copy-public-to-dist.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    build,
    /\.well-known\/apple-developer-merchantid-domain-association/,
  );
  assert.match(build, /mkdirSync\(path.dirname\(dest\)/);
});
