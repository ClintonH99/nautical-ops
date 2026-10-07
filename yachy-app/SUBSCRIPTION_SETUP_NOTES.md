# Web subscription migration

## Approved architecture

Nautical Ops is moving to a mobile-first web application with **Paddle as its only billing provider**. All existing Apple subscriptions were confirmed by the owner to be sandbox tests. Native source/migrations are retained temporarily for safe migration, not as an active release plan.

The source of truth remains `vessel_subscriptions`. Neither checkout redirection nor a client success callback grants access. Crew limits, Captain/MOV billing responsibility, two-device security, the 16-day failed-renewal grace period and personal Sea Miles preservation remain unchanged.

## Implementation — server foundation deployed, payments disabled

On 1 October 2026 the additive migration and billing functions were deployed to `grtrcjgsvfsknpnlarxv`. `PADDLE_CHECKOUT_ENABLED` is explicitly false and the web payment button is disabled. The catalogue is not configured/verified, so deployment does not mean payments are operational. Existing subscription rows were not retired or modified.

- `create-paddle-checkout` verifies the authenticated account and reserves checkout through a registered-device/Captain-only database function. Existing paid plans must be managed, not purchased again. Concurrent requests share one pending checkout per vessel.
- Every selected Paddle price is checked against the approved USD amount and recurring interval before purchase. The local 6 October implementation requires a free 30-day trial and tax-inclusive pricing (`internal`); regional price overrides and quantities other than one are rejected. These changes are not yet deployed. Internal duration calculations are never shown as percentage-discount labels.
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
- `PADDLE_CHECKOUT_URL`: HTTPS payment-page URL, without query parameters or fragments. Returned transaction links must match its origin and path.
- Supabase-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

### 6 October sandbox setup checkpoint

The owner approved a sandbox-only API key for catalogue, test subscriptions/transactions and webhook verification. It was created as **Nautical Ops Sandbox Integration Oct 2026**, expires **5 November 2026**, and was saved as the encrypted Supabase Edge Function secret `PADDLE_SANDBOX_API_KEY`. No key value belongs in this repository. Live credentials/settings and the disabled checkout switch were not changed.

Local code now includes `/checkout`, Paddle.js initialization with a public client-side token, server-validated checkout links and the web plan-selection entry point. Build-time `EXPO_PUBLIC_PADDLE_CHECKOUT_ENABLED` defaults to false. When deliberately enabled, `EXPO_PUBLIC_PADDLE_ENV` must match the server and `EXPO_PUBLIC_PADDLE_CLIENT_TOKEN` must be a public Paddle client-side token for that environment, never an API key. Successful browser checkout does not grant access; the signed server event remains authoritative. Existing subscribers cannot accidentally buy another subscription through this new-purchase entry point.

The sandbox catalogue, notification destination and end-to-end transactions are not yet verified. New checkout code is local only, not deployed or enabled. All plan changes were approved to take effect immediately, with a charge/credit preview; subscription-management implementation remains outstanding and must preserve any existing trial end rather than restarting it.

Confirmed 7 October: the 30-day trial starts without payment details. At 14 days remaining, Captain/MOV receives a dismissible Home reminder with Continue and See Plans. Local reminder code uses the server entitlement, is scoped by account/vessel/trial, and is gated behind the disabled web Paddle switch. It does not alter access, collect payment or change the trial end. It is checked when Home gains focus and dismissed once per trial on that browser; it is not an email schedule or an account-wide dismissal. Unknown status never becomes a payment warning.

Paddle cardless trials require a separate server-side creation flow, a price with `trial_period.requires_payment_method: false`, and later the subscription update-payment-method transaction with one-page checkout. The existing generic checkout handler is NOT that flow. Keep payments/reminders disabled until cardless trial creation, authenticated payment-detail collection and signed-event synchronization are implemented and tested together. Adding details must preserve the original trial end: do not call trial activation or move the billing date forward. Paddle currently does not send cardless-trial-ending emails. The reminder is a trial-end notice, not proof that payment details are missing.

At the 6 October checkpoint, 22 root server/browser tests and 5 app billing tests passed, along with TypeScript, targeted lint and a production web export. The separate database replay was not rerun: the previous temporary PGlite installation is missing and its replacement download did not complete.

Deploy webhook with Supabase JWT verification disabled only for the signed provider endpoint. Checkout still requires user authentication and database device/role checks. Subscribe the notification destination to subscription lifecycle events. Reconcile already-existing provider subscriptions separately: arbitrary pre-existing subscription IDs are intentionally not accepted as new vessel bindings.

Paddle needs an approved default payment page that loads Paddle.js. A returned checkout URL does not by itself mean that page exists or works. Verify the page, tax treatment, promo-code behavior and final consent/amount before enabling payments.

## Required before cutover

1. Verify the real sandbox catalogue and run purchase, cancellation, failed renewal, retry and recovery tests. Verify all live IDs separately without making live test purchases.
2. Finish subscription management, plan-change timing, secure payer/portal access and ambiguous-checkout reconciliation. Do not give one vessel's Captain access to another vessel's billing account via an overly broad customer portal session.
3. Complete provider reconciliation/expiry enforcement without treating a network outage as proof of non-payment. Existing expired-active fail-open behavior has not been silently changed by this additive migration.
4. Archive Apple sandbox billing metadata recoverably, switch active billing handlers and verify access from real browser sessions. Do not delete users, vessels or operational records.
5. The foundation migration and functions are deployed. Keep payments disabled until the remaining checks pass, and prepare rollback/reconciliation before enabling them.

## Tests and provider references

From the repository root: `npm test` covers provider configuration, catalogue checks, HMAC, checkout handlers and webhook failure behavior.

From `yachy-app`, with a disposable PGlite installation: `PGLITE_MODULE_PATH=/path/to/@electric-sql/pglite node supabase/tests/run_paddle_billing_test.cjs`. No linked/live database is used.

- [Paddle transaction creation](https://developer.paddle.com/api-reference/transactions/create-transaction/)
- [Paddle cardless trials and payment collection](https://developer.paddle.com/build/trials/cardless-trials/)
- [Webhook signature verification](https://developer.paddle.com/webhooks/about/signature-verification/)
- [Webhook delivery, duplicates and ordering](https://developer.paddle.com/webhooks/about/how-webhooks-work/)
