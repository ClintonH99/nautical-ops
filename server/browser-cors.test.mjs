import test from "node:test";
import assert from "node:assert/strict";
import { withBrowserCors } from "../yachy-app/supabase/functions/_shared/browserCors.ts";

const preview = "https://nautical-9yvxtbrvi-clintonh99s-projects.vercel.app";
const sandbox = {
  PADDLE_ENV: "sandbox",
  PADDLE_CHECKOUT_ENABLED: "false",
  PADDLE_SANDBOX_PREVIEW_ORIGIN: preview,
};
const request = (origin, method = "OPTIONS") =>
  new Request("https://example.test/function", {
    method,
    headers: { origin, "access-control-request-method": "POST" },
  });
const options = (env) => ({ getEnv: (key) => env[key] });

test("only the exact approved preview has sandbox CORS access", async () => {
  const handler = withBrowserCors(
    async () => new Response("ok"),
    options(sandbox),
  );
  const response = await handler(request(preview));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), preview);
  for (const origin of [
    "https://another-clintonh99s-projects.vercel.app",
    "https://nautical-9yvxtbrvi-clintonh99s-projects.vercel.app.attacker.test",
    "http://nautical-9yvxtbrvi-clintonh99s-projects.vercel.app",
    "null",
  ]) {
    assert.equal((await handler(request(origin))).status, 403);
  }
});

test("preview access fails closed outside sandbox, with checkout enabled or without opt-in", async () => {
  for (const env of [
    { ...sandbox, PADDLE_ENV: "live" },
    { ...sandbox, PADDLE_CHECKOUT_ENABLED: "true" },
    { ...sandbox, PADDLE_CHECKOUT_ENABLED: undefined },
    { ...sandbox, PADDLE_SANDBOX_PREVIEW_ORIGIN: undefined },
  ]) {
    const handler = withBrowserCors(
      async () => new Response("ok"),
      options(env),
    );
    assert.equal((await handler(request(preview))).status, 403);
  }
  const otherFunction = withBrowserCors(async () => new Response("ok"));
  assert.equal((await otherFunction(request(preview))).status, 403);
  assert.equal(
    (await otherFunction(request("https://nautical-ops.com"))).status,
    204,
  );
});

test("an allowed preview does not bypass handler authentication or method restrictions", async () => {
  let calls = 0;
  const handler = withBrowserCors(async () => {
    calls++;
    return new Response("Unauthorized", { status: 401 });
  }, options(sandbox));
  const denied = await handler(request(preview, "POST"));
  assert.equal(denied.status, 401);
  assert.equal(calls, 1);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), preview);
  const invalidPreflight = new Request("https://example.test/function", {
    method: "OPTIONS",
    headers: { origin: preview, "access-control-request-method": "DELETE" },
  });
  assert.equal((await handler(invalidPreflight)).status, 405);
  assert.equal(calls, 1);
});
