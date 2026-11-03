import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  billingMessages,
  sendStoredEmail,
} from "../yachy-app/supabase/functions/_shared/billingEmails.mjs";
const id = (p) => `${p}_${"a".repeat(26)}`;
export const fixture = () => ({
  subscription: {
    id: id("sub"),
    customer_id: id("ctm"),
    status: "trialing",
    collection_mode: "automatic",
    current_billing_period: { ends_at: "2026-12-03T12:00:00Z" },
  },
  transactions: [],
  link: {
    environment: "live",
    subscription_id: id("sub"),
    customer_id: id("ctm"),
  },
  vessel: {
    name: "Example Vessel",
    plan_tier: "1_5",
    billing_period: "monthly",
  },
  recipient: {
    id: "captain-id",
    email: "captain@example.com",
    name: "Captain",
  },
  since: "2026-11-03T00:00:00Z",
  now: Date.parse("2026-11-03T12:00:00Z"),
});
const transaction = (extra = {}) => ({
  id: id("txn"),
  subscription_id: id("sub"),
  customer_id: id("ctm"),
  status: "completed",
  created_at: "2026-11-03T11:00:00Z",
  collection_mode: "automatic",
  currency_code: "USD",
  origin: "subscription_payment_method_change",
  details: { totals: { grand_total: "0", balance: "0" } },
  payments: [],
  ...extra,
});
test("trial has confirmed date, no-charge explanation and existing invite destination", () => {
  const [m] = billingMessages(fixture());
  assert.equal(m.kind, "trial");
  assert.match(m.message.text, /3 December 2026/);
  assert.match(m.message.text, /US\$0.00/);
  assert.match(m.message.html, /vessel-settings\?section=invite-code/);
  assert.doesNotMatch(m.message.subject, /paid|payment confirmed/i);
});
test("payment-method completion adds billing confirmation but never payment receipt", () => {
  const f = fixture();
  f.transactions = [transaction()];
  const m = billingMessages(f);
  assert.deepEqual(
    m.map((x) => x.kind),
    ["trial", "billing"],
  );
  assert.match(m[1].message.text, /No subscription payment was taken/);
});
test("positive captured full payment produces amount including tax and real reference", () => {
  const f = fixture();
  f.subscription.status = "active";
  f.transactions = [
    transaction({
      origin: "subscription_recurring",
      details: { totals: { grand_total: "9199", balance: "0" } },
      payments: [
        {
          status: "captured",
          amount: "9199",
          captured_at: "2026-11-03T11:00:00Z",
        },
      ],
    }),
  ];
  const [m] = billingMessages(f);
  assert.equal(m.kind, "paid");
  assert.match(m.message.text, /\$91.99/);
  assert.match(m.message.text, new RegExp(id("txn")));
});
for (const status of [
  "authorized",
  "pending_no_action_required",
  "error",
  "canceled",
])
  test(`payment status ${status} is not charged`, () => {
    const f = fixture();
    f.subscription.status = "active";
    f.transactions = [
      transaction({
        origin: "web",
        details: { totals: { grand_total: "9199", balance: "0" } },
        payments: [
          { status, amount: "9199", captured_at: "2026-11-03T11:00:00Z" },
        ],
      }),
    ];
    assert.ok(billingMessages(f).every((x) => x.kind !== "paid"));
  });
test("partially captured payment is not full payment confirmation", () => {
  const f = fixture();
  f.transactions = [
    transaction({
      origin: "web",
      details: { totals: { grand_total: "9199", balance: "0" } },
      payments: [
        {
          status: "captured",
          amount: "100",
          captured_at: "2026-11-03T11:00:00Z",
        },
      ],
    }),
  ];
  assert.ok(billingMessages(f).every((x) => x.kind !== "paid"));
});
test("zero-value transaction with active access sends access confirmation, not paid", () => {
  const f = fixture();
  f.subscription.status = "active";
  f.transactions = [transaction({ origin: "api" })];
  assert.deepEqual(
    billingMessages(f).map((x) => x.kind),
    ["active"],
  );
});
test("expired/canceled trials do not receive an active trial claim", () => {
  const f = fixture();
  f.now = Date.parse("2027-01-01");
  assert.deepEqual(billingMessages(f), []);
  f.now = Date.parse("2026-11-03");
  f.subscription.status = "canceled";
  assert.deepEqual(billingMessages(f), []);
});
test("sandbox, mismatched subscriptions/customers and unknown plans are rejected", () => {
  for (const mutate of [
    (f) => (f.link.environment = "sandbox"),
    (f) => (f.subscription.customer_id = id("wrong")),
    (f) => (f.subscription.id = id("wrong")),
    (f) => (f.vessel.plan_tier = "unknown"),
    (f) => (f.transactions = [transaction({ customer_id: id("wrong") })]),
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => billingMessages(f));
  }
});
test("old transactions cannot produce catch-up receipts", () => {
  const f = fixture();
  f.transactions = [transaction({ created_at: "2025-01-01T00:00:00Z" })];
  assert.deepEqual(
    billingMessages(f).map((x) => x.kind),
    ["trial"],
  );
});
test("untrusted vessel and captain names are escaped", () => {
  const f = fixture();
  f.vessel.name = "<script>alert(1)</script>";
  f.recipient.name = "<img onerror=x>";
  const [m] = billingMessages(f);
  assert.doesNotMatch(m.message.html, /<script>|<img onerror/);
  assert.match(m.message.html, /&lt;script&gt;/);
});
test("keys deduplicate trial by subscription and billing updates by transaction", () => {
  const f = fixture();
  f.transactions = [transaction()];
  assert.deepEqual(
    billingMessages(f).map((x) => x.key),
    billingMessages(f).map((x) => x.key),
  );
  f.transactions[0].id = `txn_${"b".repeat(26)}`;
  assert.notEqual(
    billingMessages(f)[1].key,
    billingMessages({ ...f, transactions: [transaction()] })[1].key,
  );
});
test("accepted record never calls email provider again", async () => {
  const r = await sendStoredEmail(
    { status: "accepted", provider_id: "sent" },
    { apiKey: "test", fetcher: () => assert.fail("duplicate send") },
  );
  assert.equal(r.duplicate, true);
});
test("ambiguous attempts older than idempotency window require review", async () => {
  const r = await sendStoredEmail(
    { status: "pending", first_attempt_at: "2026-11-01T00:00:00Z" },
    {
      apiKey: "test",
      now: Date.parse("2026-11-03"),
      fetcher: () => assert.fail("unsafe retry"),
    },
  );
  assert.equal(r.review, true);
});
test("send uses immutable stored body and stable provider idempotency key", async () => {
  const row = {
    email_key: "billing-v1/test",
    message: { subject: "stored" },
    status: "pending",
  };
  const r = await sendStoredEmail(row, {
    apiKey: "test",
    fetcher: async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(options.headers["Idempotency-Key"], row.email_key);
      assert.equal(options.body, JSON.stringify(row.message));
      return Response.json({ id: "accepted-id" });
    },
  });
  assert.equal(r.id, "accepted-id");
});
test("provider rejection or missing ID is not reported as sent", async () => {
  for (const response of [
    new Response("", { status: 429 }),
    Response.json({ error: "rejected" }),
  ])
    await assert.rejects(
      sendStoredEmail(
        { message: {}, email_key: "key" },
        { apiKey: "test", fetcher: async () => response },
      ),
    );
});
test("queue migration starts disabled with RLS and no client access", () => {
  const sql = readFileSync(
    new URL(
      "../yachy-app/supabase/migrations/20261103122752_billing_confirmation_emails.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /enabled boolean NOT NULL DEFAULT false/);
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length, 3);
  assert.match(sql, /FROM PUBLIC,anon,authenticated/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.doesNotMatch(
    sql,
    /UPDATE public\.vessel_subscriptions|UPDATE public\.users/,
  );
});
