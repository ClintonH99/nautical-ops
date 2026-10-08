import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
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
const source = fs.readFileSync(
  new URL("../yachy-app/public/paddle-checkout.js", import.meta.url),
  "utf8",
);
function checkoutPage(
  config,
  transaction = `txn_${"1".repeat(26)}`,
  options = {},
) {
  const nodes = { status: { textContent: "" }, environment: { hidden: true } };
  const scripts = [];
  const calls = [];
  const win = {
    NAUTICAL_PADDLE: config,
    location: { search: options.search || `?_ptxn=${transaction}` },
    sessionStorage: {
      getItem: () => JSON.stringify(options.prefill || null),
      removeItem: (key) => calls.push({ removed: key }),
    },
    Paddle: {
      Environment: { set: (env) => calls.push(env) },
      Initialize: (settings) => calls.push(settings),
      Checkout: { open: (settings) => calls.push({ opened: settings }) },
    },
  };
  vm.runInNewContext(source, {
    URLSearchParams,
    window: win,
    document: {
      getElementById: (id) => nodes[id],
      createElement: () => ({}),
      head: { appendChild: (s) => scripts.push(s) },
    },
  });
  return { nodes, scripts, calls };
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
  assert.equal(page.nodes.environment.hidden, false);
  page.calls[1].eventCallback({ name: "checkout.completed" });
  assert.match(page.nodes.status.textContent, /server-confirmed/);
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
