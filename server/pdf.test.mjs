import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizePdf,
  createPdfHandler,
  parsePdfInput,
  renderPdf,
  MAX_HTML_BYTES,
} from "./pdf.mjs";

test("rejects missing, malformed and oversized documents", () => {
  for (const body of [
    null,
    {},
    { html: "" },
    { html: 12 },
    "{",
    { html: "x".repeat(MAX_HTML_BYTES + 1) },
  ]) {
    assert.throws(() => parsePdfInput(body));
  }
  assert.equal(
    parsePdfInput(JSON.stringify({ html: "<p>hello</p>" })),
    "<p>hello</p>",
  );
});

test("PDF authorization requires a valid user AND an authorized device session", async () => {
  const env = {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_ANON_KEY: "public-key",
  };
  let calls = [];
  const fetcher = async (url, options) => {
    calls.push([url, options]);
    return {
      ok: true,
      json: async () => (url.includes("/auth/") ? { id: "user" } : true),
    };
  };
  assert.equal(await authorizePdf(null, env, fetcher), false);
  assert.equal(calls.length, 0);
  assert.equal(await authorizePdf("Bearer test", env, fetcher), true);
  assert.equal(
    calls[1][0],
    "https://test.supabase.co/rest/v1/rpc/current_session_has_device_access",
  );
  assert.equal(calls[1][1].headers.Authorization, "Bearer test");
  assert.equal(
    await authorizePdf("Bearer test", env, async (url) => ({
      ok: true,
      json: async () => (url.includes("/auth/") ? { id: "user" } : false),
    })),
    false,
  );
  assert.equal(
    await authorizePdf("Bearer test", env, async () => ({ ok: false })),
    false,
  );
});

function response() {
  return {
    headers: {},
    code: 0,
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}
const request = {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer test" },
  body: { html: "<p>test</p>" },
};

test("renderer disables scripts, blocks remote/file requests and always closes Chromium", async () => {
  let scripts,
    intercept,
    requestHandler,
    closed = 0,
    prepared;
  const page = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    async setJavaScriptEnabled(value) {
      scripts = value;
    },
    async setRequestInterception(value) {
      intercept = value;
    },
    on(event, handler) {
      assert.equal(event, "request");
      requestHandler = handler;
    },
    async setContent(html) {
      prepared = html;
    },
    async pdf() {
      return new Uint8Array([1]);
    },
  };
  const browser = {
    newPage: async () => page,
    close: async () => {
      closed++;
    },
  };
  await renderPdf("<script>unsafe()</script>", async () => browser);
  assert.equal(scripts, false);
  assert.equal(intercept, true);
  assert.equal(closed, 1);
  assert.ok(prepared.startsWith('<meta http-equiv="Content-Security-Policy"'));
  for (const [url, expected] of [
    ["https://example.com/image.png", "abort"],
    ["file:///etc/passwd", "abort"],
    ["http://169.254.169.254", "abort"],
    ["data:text/html,test", "abort"],
    ["data:image/png;base64,test", "continue"],
    ["data:font/truetype;base64,test", "continue"],
  ]) {
    let action;
    requestHandler({
      url: () => url,
      abort: async () => {
        action = "abort";
      },
      continue: async () => {
        action = "continue";
      },
    });
    assert.equal(action, expected);
  }
  page.pdf = async () => {
    throw new Error("bad content");
  };
  await assert.rejects(renderPdf("<p>test</p>", async () => browser));
  assert.equal(closed, 2);
});

test("unauthorized requests never launch Chromium and errors never expose document content", async () => {
  let renders = 0;
  const handler = createPdfHandler({
    authorize: async () => false,
    render: async () => {
      renders++;
    },
  });
  const res = response();
  await handler(request, res);
  assert.equal(res.code, 403);
  assert.equal(renders, 0);
  await handler({ ...request, method: "GET" }, res);
  assert.equal(res.code, 405);
  await handler({ ...request, headers: {} }, res);
  assert.equal(res.code, 415);
  await handler({ ...request, body: {} }, res);
  assert.equal(res.code, 400);
  const broken = createPdfHandler({
    authorize: async () => true,
    render: async () => {
      throw new Error("private crew details");
    },
  });
  await broken(request, res);
  assert.equal(res.code, 503);
  assert.ok(!JSON.stringify(res.body).includes("private crew"));
});

test("returns private PDF bytes and limits concurrent rendering per instance", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const handler = createPdfHandler({
    authorize: async () => true,
    render: () => pending,
  });
  const first = response();
  const job = handler(request, first);
  await new Promise((resolve) => setImmediate(resolve));
  const second = response();
  await handler(request, second);
  assert.equal(second.code, 429);
  finish(new Uint8Array([37, 80, 68, 70]));
  await job;
  assert.equal(first.code, 200);
  assert.equal(first.headers["Cache-Control"], "private, no-store");
  assert.equal(first.headers["Content-Type"], "application/pdf");
  assert.equal(first.body.toString(), "%PDF");
});
