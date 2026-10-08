import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../yachy-app/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");
const html = fs.readFileSync(
  new URL("../yachy-app/public/landing.html", import.meta.url),
  "utf8",
);
const script = fs.readFileSync(
  new URL("../yachy-app/public/landing.js", import.meta.url),
  "utf8",
);
const css = fs.readFileSync(
  new URL("../yachy-app/public/landing.css", import.meta.url),
  "utf8",
);
function page() {
  const dom = new JSDOM(html, {
    url: "https://www.nautical-ops.com/",
    runScripts: "outside-only",
  });
  dom.window.eval(script);
  return dom;
}

test("homepage links use real app/support routes and correct icon assets", () => {
  const dom = page();
  const doc = dom.window.document;
  const links = [...doc.querySelectorAll("a")];
  assert.ok(
    links
      .filter((a) => a.textContent.includes("Open Web App"))
      .every((a) => a.getAttribute("href") === "/login"),
  );
  assert.equal(
    links
      .find((a) => a.textContent.includes("View vessel plans"))
      .getAttribute("href"),
    "/vessel-plans",
  );
  assert.ok(doc.querySelector('a[href="/support"]'));
  assert.ok(doc.querySelector('a[href="/refund-policy"]'));
  assert.ok(doc.querySelector('.no-brand img[src="/favicon-vessel.png"]'));
  for (const link of links.filter((a) =>
    a.getAttribute("href").startsWith("#"),
  ))
    assert.ok(doc.querySelector(link.getAttribute("href")), link.href);
  assert.equal(doc.querySelectorAll("[data-preview]").length, 0);
  assert.doesNotMatch(
    html + script,
    /window\.openai|new Tweak|apps\.apple\.com|Download for iOS|YOUR_SUPABASE_ANON_KEY|devices\.css|<video/,
  );
  dom.window.close();
});

test("24 price choices display the full period base price with tax disclosure", () => {
  const dom = page();
  const doc = dom.window.document;
  const monthly = [7999, 8999, 11999, 14999, 19999, 24999];
  for (let tier = 0; tier < 6; tier++) {
    const select = doc.querySelector("#no-crew-size");
    select.value = String(tier);
    select.dispatchEvent(new dom.window.Event("change"));
    for (const [months, percent] of [
      [1, 100],
      [3, 95],
      [6, 92],
      [12, 90],
    ]) {
      doc.querySelector(`[data-months="${months}"]`).click();
      const amount = Math.round((monthly[tier] * months * percent) / 100) / 100;
      assert.ok(
        doc
          .querySelector("#no-price")
          .textContent.startsWith(
            "$" +
              amount.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }),
          ),
      );
      assert.equal(
        doc.querySelectorAll('[data-months][aria-pressed="true"]').length,
        1,
      );
      assert.match(
        doc.querySelector("#no-price-note").textContent,
        /USD base price/,
      );
    }
  }
  assert.match(
    doc.querySelector("#no-pricing").textContent,
    /VAT \/ sales tax is calculated/,
  );
  assert.doesNotMatch(
    doc.querySelector("#no-pricing").textContent,
    /\d+%|discount/i,
  );
  dom.window.close();
});

test("feature explorer and both home screen guides work", () => {
  const dom = page();
  const doc = dom.window.document;
  for (const feature of ["trips", "tasks", "crew", "records"]) {
    doc.querySelector(`[data-feature="${feature}"]`).click();
    assert.equal(
      doc.querySelectorAll('[data-feature][aria-pressed="true"]').length,
      1,
    );
    assert.equal(
      doc.querySelectorAll("#no-detail-list .no-detail-item").length,
      3,
    );
  }
  assert.match(
    doc.querySelector("#no-feature-heading").textContent,
    /Useful records/,
  );
  for (const device of ["android", "iphone"]) {
    doc.querySelector(`[data-home="${device}"]`).click();
    assert.equal(doc.querySelector(`#no-home-${device}`).hidden, false);
    assert.equal(
      doc.querySelectorAll('[data-home][aria-pressed="true"]').length,
      1,
    );
  }
  assert.equal(doc.querySelector("#no-home-android").hidden, true);
  dom.window.close();
});

test("mobile menu opens, closes on navigation, and supports Escape", () => {
  const dom = page();
  const doc = dom.window.document;
  const button = doc.querySelector(".no-menu");
  const menu = doc.querySelector("#no-mobile-nav");
  button.click();
  assert.equal(menu.hidden, false);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  menu.querySelector("a").click();
  assert.equal(menu.hidden, true);
  button.click();
  button.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.equal(menu.hidden, true);
  assert.equal(doc.activeElement, button);
  dom.window.close();
});

test("donations never invent totals or request private data; page stays light and static", () => {
  const dom = page();
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll(".no-donation-counter").length, 3);
  assert.match(
    doc.querySelector(".no-donation-note").textContent,
    /not available yet/,
  );
  assert.equal(doc.querySelector("#stat-donated").textContent, "$—");
  assert.doesNotMatch(
    script,
    /fetch\(|supabase|requestAnimationFrame|setInterval/,
  );
  assert.match(css, /color-scheme:\s*light/);
  assert.match(css, /@container\s*\(max-width:\s*580px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  dom.window.close();
});

test("deployment copy list includes new static assets", () => {
  const copy = fs.readFileSync(
    new URL("../yachy-app/scripts/copy-public-to-dist.mjs", import.meta.url),
    "utf8",
  );
  assert.match(copy, /'landing.css'/);
  assert.match(copy, /'landing.js'/);
});
