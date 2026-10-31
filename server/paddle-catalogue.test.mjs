import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import {
  approvedPrice,
  validatePrice,
} from "../yachy-app/supabase/functions/_shared/paddle.mjs";

const require = createRequire(
  new URL("../yachy-app/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const read = (path) =>
  fs.readFileSync(new URL(`../yachy-app/${path}`, import.meta.url), "utf8");

// Independently transcribed from the LIVE Paddle dashboard on 29 October 2026.
// These are full-period USD base amounts, not tax-inclusive checkout totals.
const rows = [
  ["1_5", "1-5", [7999, 22999, 44999, 86999]],
  ["6_10", "6-10", [8999, 25999, 49999, 97999]],
  ["11_15", "11-15", [11999, 34999, 66999, 129999]],
  ["16_25", "16-25", [14999, 42999, 82999, 161999]],
  ["26_40", "26-40", [19999, 56999, 110999, 215999]],
  ["40_plus", "40plus", [24999, 71999, 137999, 269999]],
];
const periods = [
  ["monthly", "monthly", 1],
  ["3_months", "3months", 3],
  ["6_months", "6months", 6],
  ["12_months", "yearly", 12],
];
const client = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(read("src/constants/paddlePlans.ts"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  client,
);

test("all 24 Paddle totals agree across the client, server and both public pages", () => {
  const pricing = new JSDOM(read("public/pricing.html"), {
    runScripts: "outside-only",
  });
  const landing = new JSDOM(read("public/landing.html"), {
    runScripts: "outside-only",
  });
  try {
    pricing.window.eval(read("public/pricing.js"));
    landing.window.eval(read("public/landing.js"));
    rows.forEach(([tier, card, amounts], i) => {
      const select = landing.window.document.querySelector("#no-crew-size");
      select.value = String(i);
      select.dispatchEvent(new landing.window.Event("change"));
      periods.forEach(([period, toggle, months], j) => {
        const cents = amounts[j];
        assert.equal(
          client.exports.getPaddlePrice(tier, period).totalCents,
          cents,
        );
        assert.equal(approvedPrice(tier, period).amount, String(cents));
        assert.equal(approvedPrice(tier, period).months, months);
        pricing.window.document
          .querySelector(`[data-billing="${toggle}"]`)
          .click();
        assert.equal(
          pricing.window.document.querySelector(`#price-${card}`).textContent,
          `$${(cents / 100).toFixed(2)}`,
        );
        landing.window.document
          .querySelector(`[data-months="${months}"]`)
          .click();
        const displayed = landing.window.document
          .querySelector("#no-price")
          .textContent.split(" / ")[0];
        assert.equal(
          displayed,
          `$${(cents / 100).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`,
        );
        const providerPrice = {
          status: "active",
          unit_price: { amount: String(cents), currency_code: "USD" },
          billing_cycle: { interval: "month", frequency: months },
          trial_period: { interval: "day", frequency: 30 },
          tax_mode: "external",
          quantity: { minimum: 1, maximum: 1 },
        };
        assert.doesNotThrow(() => validatePrice(providerPrice, tier, period));
        assert.throws(() =>
          validatePrice(
            {
              ...providerPrice,
              unit_price: { amount: String(cents + 1), currency_code: "USD" },
            },
            tier,
            period,
          ),
        );
        if (months > 1) {
          const oldAmount = Math.round(
            (amounts[0] * months * { 3: 95, 6: 92, 12: 90 }[months]) / 100,
          );
          assert.notEqual(cents, oldAmount);
          assert.throws(() =>
            validatePrice(
              {
                ...providerPrice,
                unit_price: { amount: String(oldAmount), currency_code: "USD" },
              },
              tier,
              period,
            ),
          );
        }
      });
    });
  } finally {
    pricing.window.close();
    landing.window.close();
  }
});

test("monthly metadata and initial public HTML match the Paddle monthly prices", () => {
  const dom = new JSDOM(read("public/pricing.html"));
  try {
    rows.forEach(([tier, card, amounts]) => {
      assert.equal(
        client.exports.PADDLE_PLAN_TIERS.find((p) => p.id === tier)
          .monthlyCents,
        amounts[0],
      );
      assert.equal(
        dom.window.document.querySelector(`#price-${card}`).textContent,
        `$${(amounts[0] / 100).toFixed(2)}`,
      );
    });
  } finally {
    dom.window.close();
  }
});
