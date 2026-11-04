import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { welcomeMessage } from "../yachy-app/supabase/functions/_shared/welcomeEmails.mjs";
import {
  emailLogo,
  emailLogoAttachments,
} from "../yachy-app/supabase/functions/_shared/emailBrand.mjs";
import { processWelcomeEmails } from "../yachy-app/supabase/functions/_shared/welcomeEmailWorker.mjs";

const time = Date.parse("2026-11-04T16:00:00Z");
function harness() {
  const job = {
    user_id: "11111111-1111-4111-8111-111111111111",
    kind: "captain",
    recipient: { email: "captain@example.com", name: "Example" },
    vessel_name: "Example vessel",
    status: "pending",
    attempts: 1,
    delivery_checks: 0,
    delivery_state: "unknown",
    lease_id: "lease",
  };
  const state = {
    job,
    user: { email: job.recipient.email },
    calls: [],
    failAccepted: false,
    failSave: false,
    owned: true,
    response: () => Response.json({ id: "email-test" }),
  };
  const admin = {
    rpc: async () => ({ data: [structuredClone(job)] }),
    from(table) {
      let values,
        filters = [];
      const q = {
        select() {
          return q;
        },
        eq(k, v) {
          filters.push([k, v]);
          return q;
        },
        update(v) {
          values = v;
          return q;
        },
        maybeSingle: async () => ({ data: state.user }),
        then(resolve, reject) {
          return Promise.resolve()
            .then(() => {
              if (table !== "welcome_email_jobs")
                throw new Error("unexpected table");
              assert.ok(
                filters.some(
                  ([k, v]) => k === "lease_id" && v === job.lease_id,
                ),
              );
              if (!state.owned) return { data: [] };
              if (
                (state.failAccepted && values.status === "accepted") ||
                (state.failSave && values.message)
              )
                return { error: {} };
              Object.assign(job, values);
              return { data: [{ user_id: job.user_id }] };
            })
            .then(resolve, reject);
        },
      };
      return q;
    },
  };
  state.run = () =>
    processWelcomeEmails({
      admin,
      getEnv: () => "not-a-real-key",
      now: () => time,
      fetchImpl: async (url, options) => {
        state.calls.push({ url, options });
        return state.response(url, options);
      },
    });
  return state;
}

test("all queued welcome templates preserve existing content and embedded logo", async () => {
  const source = readFileSync(
    new URL(
      "../yachy-app/supabase/functions/send-welcome-email/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  let legacy = source
    .slice(source.indexOf("function escapeHtml"), source.indexOf("Deno.serve"))
    .replace(/interface WebhookPayload \{[\s\S]*?\n\}/, "")
    .replaceAll(": unknown", "")
    .replaceAll(": string", "")
    .replaceAll(": any", "");
  const sent = [];
  const funcs = new Function(
    "resend",
    "emailLogo",
    "emailLogoAttachments",
    legacy +
      "; return {sendCaptainSignupEmail,sendCrewJoinedEmail,sendCrewSoloSignupEmail};",
  )(
    {
      emails: {
        send: async (message) => {
          sent.push(message);
          return { data: { id: "test" } };
        },
      },
    },
    emailLogo,
    emailLogoAttachments,
  );
  const record = { email: "captain@example.com", name: "<Example & Test>" };
  await funcs.sendCaptainSignupEmail(record.email, record.name);
  await funcs.sendCrewJoinedEmail(record, "<Vessel>\nTest");
  await funcs.sendCrewSoloSignupEmail(record);
  for (const [i, kind] of ["captain", "crew_joined", "crew_solo"].entries()) {
    const message = welcomeMessage({
      kind,
      recipient: record,
      vessel_name: "<Vessel>\nTest",
    });
    const { replyTo, ...rest } = sent[i];
    assert.deepEqual(message, {
      ...rest,
      reply_to: replyTo,
      attachments: emailLogoAttachments(),
    });
  }
});
test("acceptance is recorded with provider ID, immutable message and idempotency key", async () => {
  const s = harness();
  const result = await s.run();
  assert.equal(result.accepted, 1);
  assert.equal(s.job.status, "accepted");
  assert.equal(s.job.delivery_state, "unknown");
  assert.equal(s.job.provider_id, "email-test");
  assert.ok(s.job.first_attempt_at);
  assert.deepEqual(JSON.parse(s.calls[0].options.body), s.job.message);
  assert.equal(
    s.calls[0].options.headers["Idempotency-Key"],
    "welcome-v1/" + s.job.user_id,
  );
});
test("provider 429/500, malformed success and concurrent request errors are retried, not marked sent", async () => {
  for (const code of [429, 500, 409, 200]) {
    const s = harness();
    s.response = () =>
      Response.json(
        { name: "concurrent_idempotent_requests" },
        { status: code },
      );
    assert.equal((await s.run()).retried, 1);
    assert.equal(s.job.status, "pending");
    assert.ok(s.job.available_at);
  }
});
test("permanent provider rejection is visible without raw error/recipient leakage", async () => {
  for (const code of [400, 401, 403, 422, 409]) {
    const s = harness();
    s.response = () =>
      Response.json(
        { name: "invalid_idempotent_request", message: "secret body" },
        { status: code },
      );
    assert.equal((await s.run()).failed, 1);
    assert.equal(s.job.status, "failed");
    assert.equal(s.job.last_result, "provider_rejected_" + code);
  }
});
test("timeout and failure saving acceptance retry identical request without new identity", async () => {
  for (const timeout of [false, true]) {
    const s = harness();
    s.failAccepted = !timeout;
    if (timeout)
      s.response = () => {
        throw new Error("timeout after possible send");
      };
    assert.equal((await s.run()).errors, 1);
    assert.equal(s.job.status, "pending");
    s.job.attempts++;
    s.failAccepted = false;
    s.response = () => Response.json({ id: "email-test" });
    assert.equal((await s.run()).accepted, 1);
    assert.equal(s.calls[0].options.body, s.calls[1].options.body);
    assert.equal(
      s.calls[0].options.headers["Idempotency-Key"],
      s.calls[1].options.headers["Idempotency-Key"],
    );
  }
});
test("cannot send before payload persistence or after lease loss", async () => {
  for (const option of ["failSave", "owned"]) {
    const s = harness();
    s[option] = option === "failSave";
    await s.run();
    assert.equal(s.calls.length, 0);
  }
});
test("23h cutoff, retry exhaustion and changed recipient require manual review with no send", async () => {
  for (const option of ["expired", "exhausted", "changed", "deleted"]) {
    const s = harness();
    if (option === "expired")
      s.job.first_attempt_at = new Date(time - 23 * 3600000).toISOString();
    if (option === "exhausted") s.job.attempts = 13;
    if (option === "changed") s.user.email = "changed@example.com";
    if (option === "deleted") s.user = null;
    assert.equal((await s.run()).review, 1);
    assert.equal(s.calls.length, 0);
  }
});
test("accepted email only queries delivery; denied tracking never resends", async () => {
  for (const code of [200, 403, 500]) {
    const s = harness();
    s.job.status = "accepted";
    s.job.provider_id = "email-test";
    s.job.delivery_checks = 1;
    s.response = () =>
      Response.json(
        { id: "email-test", last_event: "delivered" },
        { status: code },
      );
    assert.equal((await s.run()).checked, 1);
    assert.equal(s.calls[0].url, "https://api.resend.com/emails/email-test");
    assert.equal(s.calls[0].options.method, undefined);
    assert.equal(s.job.status, "accepted");
    assert.equal(s.job.delivery_state, code === 200 ? "delivered" : "unknown");
    if (code === 403) assert.equal(s.job.delivery_checks, 12);
  }
});
