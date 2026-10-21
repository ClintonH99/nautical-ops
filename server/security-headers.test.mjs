import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(
  new URL("../yachy-app/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");

const config = JSON.parse(
  fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
);
const policy = config.routes[0];
test("security headers cover all routes before filesystem and SPA rewrites", () => {
  assert.equal(policy.src, "/(.*)");
  assert.equal(policy.continue, true);
  assert.equal(policy.dest, undefined);
  assert.equal(config.headers, undefined); // Vercel forbids mixing headers and routes
  for (const route of [
    "/",
    "/login",
    "/checkout",
    "/api/export-pdf",
    "/landing.js",
  ]) {
    assert.ok(new RegExp(`^${policy.src}$`).test(route));
  }
  assert.equal(config.routes[2].dest, "/landing.html");
  assert.equal(config.routes[3].handle, "filesystem");
  assert.equal(config.routes.at(-1).dest, "/index.html");
});
test("strict resource policy covers only public pages, including direct HTML URLs", () => {
  const rule = config.routes[1];
  const matches = new RegExp(`^${rule.src}$`);
  for (const route of [
    "/",
    "/landing.html",
    "/pricing",
    "/pricing/",
    "/pricing.html",
    "/privacy-policy",
    "/privacy-policy.html",
    "/refund-policy",
    "/refund-policy.html",
    "/terms-and-conditions",
    "/terms-and-conditions.html",
    "/support",
    "/support.html",
  ]) {
    assert.ok(matches.test(route), route);
  }
  for (const route of [
    "/login",
    "/index.html",
    "/checkout",
    "/checkout.html",
    "/vessel-plans",
    "/api/export-pdf",
    "/pricing.js",
    "/pricing-private",
  ]) {
    assert.equal(matches.test(route), false, route);
  }
  assert.equal(rule.continue, true);
  const csp = rule.headers["Content-Security-Policy"];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'; script-src-attr 'none'/);
  assert.match(csp, /frame-src 'none'; form-action 'self'/);
  assert.doesNotMatch(
    csp,
    /unsafe-eval|script-src[^;]*unsafe-inline|https:\/\/\*/,
  );
});
test("public pages have no inline executable code or event handlers under the enforced policy", () => {
  for (const file of [
    "landing",
    "pricing",
    "privacy-policy",
    "refund-policy",
    "terms-and-conditions",
    "support",
  ]) {
    const html = fs.readFileSync(
      new URL(`../yachy-app/public/${file}.html`, import.meta.url),
      "utf8",
    );
    const dom = new JSDOM(html);
    for (const script of dom.window.document.querySelectorAll("script")) {
      assert.match(
        script.getAttribute("src") || "",
        /^\/(?:landing|pricing)\.js$/,
      );
      assert.equal(script.textContent.trim(), "");
    }
    for (const element of dom.window.document.querySelectorAll("*")) {
      for (const attribute of element.attributes) {
        assert.equal(
          /^on/i.test(attribute.name),
          false,
          `${file}: ${attribute.name}`,
        );
        assert.equal(/^\s*javascript:/i.test(attribute.value), false, file);
      }
    }
    dom.window.close();
  }
});
test("external pricing script retains all 24 approved plan prices and active button behavior", () => {
  const html = fs.readFileSync(
    new URL("../yachy-app/public/pricing.html", import.meta.url),
    "utf8",
  );
  const script = fs.readFileSync(
    new URL("../yachy-app/public/pricing.js", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  dom.window.eval(script);
  const tiers = ["1-5", "6-10", "11-15", "16-25", "26-40", "40plus"];
  const monthly = [7999, 8999, 11999, 14999, 19999, 24999];
  const periods = [
    ["monthly", 1, 100, "per month"],
    ["3months", 3, 95, "per 3 months"],
    ["6months", 6, 92, "per 6 months"],
    ["yearly", 12, 90, "per year"],
  ];
  for (const [key, months, percent, label] of periods) {
    const button = dom.window.document.querySelector(`[data-billing="${key}"]`);
    button.click();
    assert.equal(
      dom.window.document.querySelectorAll(".billing-tab.active").length,
      1,
    );
    assert.ok(button.classList.contains("active"));
    tiers.forEach((tier, index) => {
      const expected = (
        Math.round((monthly[index] * months * percent) / 100) / 100
      ).toFixed(2);
      assert.equal(
        dom.window.document.getElementById("price-" + tier).textContent,
        "$" + expected,
      );
      assert.equal(
        dom.window.document.getElementById("period-" + tier).textContent,
        label,
      );
    });
  }
  dom.window.close();
  const copyScript = fs.readFileSync(
    new URL("../yachy-app/scripts/copy-public-to-dist.mjs", import.meta.url),
    "utf8",
  );
  assert.match(copyScript, /'pricing\.js'/);
});
test("anti-framing, MIME and referrer protections are enforced without blocking Paddle frames", () => {
  assert.equal(policy.headers["X-Frame-Options"], "DENY");
  assert.equal(policy.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(
    policy.headers["Referrer-Policy"],
    "strict-origin-when-cross-origin",
  );
  assert.equal(
    policy.headers["Content-Security-Policy"],
    "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
  );
  // frame-ancestors controls who embeds us; it does not prevent our Paddle checkout iframe.
  assert.doesNotMatch(
    policy.headers["Content-Security-Policy"],
    /frame-src|script-src/,
  );
  assert.match(policy.headers["Permissions-Policy"], /camera=\(self\)/);
  assert.match(policy.headers["Permissions-Policy"], /geolocation=\(self\)/);
  assert.match(
    policy.headers["Permissions-Policy"],
    /https:\/\/buy\.paddle\.com/,
  );
});
test("full resource CSP starts report-only pending real checkout and app browser verification", () => {
  const report = policy.headers["Content-Security-Policy-Report-Only"];
  assert.match(report, /script-src 'self' https:\/\/cdn\.paddle\.com/);
  assert.match(report, /wss:\/\/\*\.supabase\.co/);
  assert.match(report, /frame-src https:\/\/\*\.paddle\.com/);
  assert.doesNotMatch(report, /unsafe-eval/);
});
