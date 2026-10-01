# Web subscription migration

## Approved architecture

Nautical Ops is moving to a mobile-first web application with **Paddle as its only billing provider**. All existing Apple subscriptions were confirmed by the owner to be sandbox tests. Native source/migrations are retained temporarily for safe migration, not as an active release plan.

The source of truth remains `vessel_subscriptions`. Neither checkout redirection nor a client success callback grants access. Crew limits, Captain/MOV billing responsibility, two-device security, the 16-day failed-renewal grace period and personal Sea Miles preservation remain unchanged.

## Local implementation — not deployed or enabled

- `create-paddle-checkout` verifies the authenticated account and reserves checkout through a registered-device/Captain-only database function. Existing paid plans must be managed, not purchased again. Concurrent requests share one pending checkout per vessel.
- Every selected Paddle price is checked against the approved USD amount and recurring interval before purchase. Trials, regional price overrides and quantities other than one are rejected until deliberately supported. Internal duration calculations are never shown as percentage-discount labels.
- `paddle-webhook` verifies HMAC against the original request body and checks signature age. A service-only database transaction binds a new subscription to the exact server-created checkout transaction, deduplicates events, rejects older snapshots, updates the entitlement and acknowledges the event together. Failed writes return an error so Paddle retries.
- Scheduled cancellation maps to the existing canceled-but-paid-through entitlement. Paused subscriptions use revoked access semantics, with the original Paddle status retained in the private provider-link table. Repeated failed-renewal updates do not restart grace.
- Outage/ambiguous-checkout failures do not trigger an automatic second purchase. Pending checkouts require reconciliation against Paddle before reopening them. This intentionally favours preventing double billing; reconciliation tooling is still a release blocker.

## Server configuration

Never put API keys or webhook secrets in `EXPO_PUBLIC_*` variables or browser code.

- `PADDLE_ENV`: exactly `sandbox` or `live`, no implicit default.
- `PADDLE_SANDBOX_API_KEY` for sandbox or `PADDLE_LIVE_API_KEY` for live. The function never falls back to the other environment's key.
- `PADDLE_PRICE_IDS`: a JSON object keyed by the six tier IDs, then the four period IDs. All 24 IDs must be present and unique in that environment. Recovering historical IDs is not verification of their current prices.
- `PADDLE_WEBHOOK_SECRET`: the notification destination secret for that same environment.
- `PADDLE_CHECKOUT_ENABLED`: must remain unset/false until end-to-end validation. Web UI is independently disabled at this checkpoint.
- Supabase-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Deploy webhook with Supabase JWT verification disabled only for the signed provider endpoint. Checkout still requires user authentication and database device/role checks. Subscribe the notification destination to subscription lifecycle events. Reconcile already-existing provider subscriptions separately: arbitrary pre-existing subscription IDs are intentionally not accepted as new vessel bindings.

Paddle needs an approved default payment page that loads Paddle.js. A returned checkout URL does not by itself mean that page exists or works. Verify the page, tax treatment, promo-code behavior and final consent/amount before enabling payments.

## Required before cutover

1. Verify the real sandbox catalogue and run purchase, cancellation, failed renewal, retry and recovery tests. Verify all live IDs separately without making live test purchases.
2. Finish subscription management, plan-change timing, secure payer/portal access and ambiguous-checkout reconciliation. Do not give one vessel's Captain access to another vessel's billing account via an overly broad customer portal session.
3. Complete provider reconciliation/expiry enforcement without treating a network outage as proof of non-payment. Existing expired-active fail-open behavior has not been silently changed by this additive migration.
4. Archive Apple sandbox billing metadata recoverably, switch active billing handlers and verify access from real browser sessions. Do not delete users, vessels or operational records.
5. Apply the migration and deploy functions with rollback preparation. Nothing in this document implies deployment has already happened.

## Tests and provider references

From the repository root: `npm test` covers provider configuration, catalogue checks, HMAC, checkout handlers and webhook failure behavior.

From `yachy-app`, with a disposable PGlite installation: `PGLITE_MODULE_PATH=/path/to/@electric-sql/pglite node supabase/tests/run_paddle_billing_test.cjs`. No linked/live database is used.

- [Paddle transaction creation](https://developer.paddle.com/api-reference/transactions/create-transaction/)
- [Webhook signature verification](https://developer.paddle.com/webhooks/about/signature-verification/)
- [Webhook delivery, duplicates and ordering](https://developer.paddle.com/webhooks/about/how-webhooks-work/)
