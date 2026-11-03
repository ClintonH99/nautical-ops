import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  emailLogo,
  emailLogoAttachments,
  EMAIL_LOGO_CID,
} from "../yachy-app/supabase/functions/_shared/emailBrand.mjs";

test("embedded logo is exactly the approved public navy vessel PNG", () => {
  const [a] = emailLogoAttachments();
  assert.deepEqual(
    Buffer.from(a.content, "base64"),
    readFileSync(
      new URL("../yachy-app/public/favicon-vessel.png", import.meta.url),
    ),
  );
  assert.ok(Buffer.byteLength(a.content) < 10000);
  assert.equal(a.content_type, "image/png");
  assert.equal(a.content_id, EMAIL_LOGO_CID);
  assert.equal(a.path, undefined);
});
test("SDK and raw API attachments use their correct content-ID field", () => {
  const [a] = emailLogoAttachments(true);
  assert.equal(a.contentId, EMAIL_LOGO_CID);
  assert.equal(a.content_id, undefined);
  assert.equal(a.contentType, "image/png");
});
test("logo has no external fetch, fixed dimensions, light backing and fallback text", () => {
  for (const size of [36, 46]) {
    const html = emailLogo(size);
    assert.match(html, new RegExp('src="cid:' + EMAIL_LOGO_CID + '"'));
    assert.match(
      html,
      new RegExp('width="' + size + '" height="' + size + '"'),
    );
    assert.match(html, /alt="Nautical Ops vessel"/);
    assert.match(html, /background-color:#ffffff/);
    assert.doesNotMatch(html, /https?:|data:/);
  }
  assert.throws(() => emailLogo("bad"));
});
test("every welcome variant attaches its shared logo; wordmark survives image blocking", () => {
  const source = readFileSync(
    new URL(
      "../yachy-app/supabase/functions/send-welcome-email/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal((source.match(/await resend.emails.send\(/g) || []).length, 4);
  assert.equal(
    (source.match(/attachments: emailLogoAttachments\(true\)/g) || []).length,
    4,
  );
  assert.match(source, /npm:resend@6\.0\.0/);
  assert.match(source, /\$\{emailLogo\(46\)\}/);
  assert.match(source, />Nautical Ops<\/td>/);
  assert.doesNotMatch(source, /mzstatic|BRAND_LOGO_URL/);
});

test(
  "pinned Resend SDK transmits content_id with the actual image bytes",
  { skip: !process.env.EMAIL_TEST_SDK_ROOT },
  async () => {
    const require = createRequire(
      process.env.EMAIL_TEST_SDK_ROOT + "/package.json",
    );
    const { Resend } = require("resend");
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async (url, options) => {
        assert.equal(String(url), "https://api.resend.com/emails");
        const body = JSON.parse(options.body);
        assert.equal(body.attachments[0].content_id, EMAIL_LOGO_CID);
        assert.equal(body.attachments[0].content_type, "image/png");
        assert.equal(
          body.attachments[0].content,
          emailLogoAttachments()[0].content,
        );
        assert.equal(body.reply_to, "support@nautical-ops.com");
        return Response.json({ id: "local-test-only" });
      };
      const response = await new Resend("dummy-local-test").emails.send({
        from: "Nautical Ops <hello@nautical-ops.com>",
        to: "example@example.com",
        replyTo: "support@nautical-ops.com",
        subject: "Logo test",
        html: emailLogo(),
        attachments: emailLogoAttachments(true),
      });
      assert.equal(response.error, null);
      assert.equal(response.data.id, "local-test-only");
    } finally {
      globalThis.fetch = original;
    }
  },
);
