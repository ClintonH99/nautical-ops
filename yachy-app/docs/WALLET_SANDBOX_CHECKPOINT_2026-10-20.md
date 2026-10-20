# Wallet sandbox checkpoint — 20 October 2026

## Saved implementation

- Branch: `fix/safari-keyboard-preview`
- Tested implementation: `5741125eb3c81f27eae76a9d6426c41c4a6a291b`
- Previous wallet UI commit: `4b6e3bb8882bb77ae4dc0f236037e04049602cfd`
- Preview: https://nautical-ops-git-fix-safari-keyboar-9d2909-clintonh99s-projects.vercel.app
- Scope: existing **Clinton Handford TEST** sandbox subscription only.

## User-confirmed results

| Test | Evidence | Result |
| --- | --- | --- |
| Apple Pay payment-method update | 19 October: iPhone Safari opened the native wallet with US$0.00; the user's screenshot showed “Payment method updated” and “Apple Pay”. The user confirmed the return to the app worked. | Passed in sandbox |
| Google Pay payment-method update | 20 October: checkout showed Sandbox / Test mode and USD 0.00 due. The user's screenshot showed “Payment method updated” and “Google Pay”; the user then confirmed normal access after returning to Nautical Ops. | Passed in sandbox |
| Manual card recovery | Earlier in this chat, the user confirmed successful payment recovery, restored crew access, and Captain return to Home with normal use. | User-confirmed sandbox recovery |

These wallet tests updated payment methods on an existing subscription. They
do **not** prove a nonzero wallet charge, an automatic wallet renewal, or live
payment processing. Browser confirmation is not a replacement for server-side
subscription verification.

## Preserved boundaries

- No public production deployment or live-payment activation as part of this checkpoint.
- No new subscription, membership change, device-limit change, or trial restart.
- Payment fields remain inside Paddle; final wallet confirmation is performed by the user.
- Keep the one-page checkout variant: express was rejected for the cardless-trial-origin subscription.
- The exact preview domain was approved for Apple Pay following the user's one-time authorization. The temporary Vercel protection exception was removed afterward; do not treat the older “verification blocked” wording in the subscription rules as current status or as permission to weaken protection.
- Separate uncommitted security-header, pricing-script and dependency work is not part of this verified wallet checkpoint.

## Next release checks

1. Reconcile server/provider evidence with these user-confirmed outcomes.
2. Verify the production catalogue, regional taxes, checkout-domain approval,
   signed webhook configuration and billing safeguards before proposing activation.
3. Keep nonzero wallet payment / renewal verification explicitly outstanding.
4. Review and test unrelated local edits separately; do not include them in a
   release merely because the wallet tests passed.
5. Obtain explicit approval before public deployment or live-payment activation.

## Local production-readiness work — not deployed

The follow-on work adds environment-bound trial reservation, existing-trial
payment setup and past-due recovery, plus subscription-specific status,
zero-charge active payment-method updates and end-of-period cancellation.
Cancellation needs a second confirmation with the current provider date. No
customer-wide portal session is issued. No new subscription, early activation,
plan mutation, membership deletion or client-side entitlement grant is added.
The React controls discard responses from a previous account/vessel and block
duplicate clicks. Ambiguous provider errors require a fresh status lookup.

### Rollout switches and dependencies

- Server live flows require `PADDLE_ENV=live`, `PADDLE_CHECKOUT_ENABLED=true`
  **and** `PADDLE_LIVE_BILLING_ENABLED=true`. The new live switch is unset/off
  by default. This work does not set any deployed switches or credentials.
- Frontend live flows require `EXPO_PUBLIC_PADDLE_ENV=live`,
  `EXPO_PUBLIC_PADDLE_CHECKOUT_ENABLED=true` and
  `EXPO_PUBLIC_PADDLE_LIVE_BILLING_ENABLED=true`. A deployed UI flag cannot
  bypass the server gate.
- Management additionally requires `PADDLE_SUBSCRIPTION_MANAGEMENT_ENABLED=true`
  server-side and `EXPO_PUBLIC_PADDLE_SUBSCRIPTION_MANAGEMENT_ENABLED=true` in
  the frontend. Both default off.
- Sandbox retains its existing trial switch and server-side tester allowlist.
  The new live-capable paths do not remove sandbox restrictions.
- Apply `20261020120000_PADDLE_ENVIRONMENT_BILLING.sql` only after approval and
  before enabling the new management endpoint or live flows. Old sandbox RPC
  signatures remain intact. No rows are rewritten by the migration.
- Deploy `manage-paddle-subscription` with normal authenticated browser CORS.
  It derives subscription/customer IDs from the Captain's device-checked vessel
  binding, not browser-supplied provider IDs.
- The webhook remains independently responsible for entitlement, including
  cancellations and renewal grace. Do not turn off webhook processing as a
  checkout kill switch. The current handler uses one configured environment,
  price catalogue and signing secret: sandbox/live webhook isolation must be
  explicitly resolved and verified before cutover.

### Verification and remaining scope

Local checks: 98 server tests, 79 disposable database checks, 66 focused client
tests, TypeScript checking and the web build (including the two-page PDF branding
check). Provider calls in the new lifecycle tests are mocked; the database suite
does not connect to Supabase. These are not evidence of new sandbox or live
provider operations. The web build includes pre-existing unrelated local edits
and is not a clean committed release artifact.
Targeted frontend lint has no errors (one existing image `require()` warning).

Still required: preview deployment and actual sandbox cancellation/payment-update
checks; immediate prorated plan/billing-period change implementation and tests;
expired/canceled subscription reactivation without another trial; reconciliation
of all 24 live prices; the allowed live payment methods; exact production checkout
domain/Apple Pay association and payment URL; live webhook signing/configuration;
nonzero wallet/renewal tests; explicit production activation approval.

## Subscription-management sandbox preview — 20 October

- User approved tests 1–3: update the existing payment method; open cancellation
  and choose Keep Subscription; then personally confirm end-of-period cancellation.
  Crew/HOD testing follows afterward. No live activation is authorized.
- Applied only `20261020120000_PADDLE_ENVIRONMENT_BILLING.sql` and recorded it in
  migration history. Deployed `manage-paddle-subscription` (authenticated in the
  handler, including Captain membership, registered device and sandbox allowlist).
  Enabled its server management switch; verified sandbox mode, checkout disabled,
  live activation off and the exact preview origin.
- Built isolated source from `5ed187c` plus the scoped billing files, excluding
  unrelated dirty dependency, pricing and security-header changes.
- Preview deployment `dpl_7bHfkLCrfABMDTWCQ7wfJnGP2hS9` is Ready:
  https://nautical-9gpuics0g-clintonh99s-projects.vercel.app.
  Existing sandbox branch alias now points to this deployment.
- Preview build flags enable sandbox management only; live billing stays off.
  Public domains were not reassigned. Build duration: 3m 29s.
- Rechecked 58 focused server tests, 79 disposable database checks and 66 client
  tests. Deployed endpoint accepts the exact preview CORS origin and rejects an
  unauthenticated request with HTTP 401.
- Before user tests, the bound test subscription remained active, had no
  cancellation scheduled, retained both members, and ended its current period at
  2026-11-19 08:40 UTC. No payment or cancellation was performed during rollout.
- Chrome test tab opened at `/vessel-plans`, already signed in and displaying the
  new Manage Subscription control. Actual user payment/cancellation results are
  still pending; a deployed page is not evidence these actions passed.

## Cancellation test and reinstatement follow-up

- User confirmed the payment-method update and Leave/Keep cancellation-preview
  tests. The subsequent cancellation was received through Paddle's webhook:
  event `evt_01m5cehzba6xatky8gwabxr1sd`, processed 20 October at 10:43:47 UTC.
  Paddle remained active with cancellation scheduled at 19 November 08:40 UTC;
  the app records `canceled` with that future access end. Both members remained.
- The user reported Manage Subscription appeared to do nothing afterward.
  A browser check showed the status request succeeded but repeated the same
  scheduled-cancellation text. The approved display change replaces that button
  with “Renewal cancelled” and the access-end date, retaining Refresh Plan Status.
- User explicitly approved Keep Subscription in **test only**, with live
  implementation to follow later. It first reads the bound provider status,
  then requires Confirm Renewal; Leave Cancelled does nothing.
- The server accepts this only for an unexpired active/trialing subscription,
  with Captain/device authorization, sandbox allowlisting and the same confirmed
  end date. It PATCHes only `scheduled_change: null`; verifies the same customer,
  subscription, status, plan, currency, period end and next billing date; performs
  no entitlement writes and never retries ambiguous writes automatically.
- This is removal of a future cancellation, not reinstatement of an already
  expired/canceled Paddle subscription. The latter requires a separately designed
  new paid subscription flow without another trial; it is not implemented here.
- Automated verification: 61 focused server tests, 53 management UI/service
  tests and TypeScript pass. Actual user confirmation of restored renewal remains
  pending; no agent has invoked the restore action.
- Updated sandbox endpoint deployed; combined preview
  `dpl_AuTFTrMsKXdi6Lb4PHzkmkZaQSED` is Ready (build 3m 35s), and the existing
  sandbox alias points to it. The earlier status-only deployment was superseded
  without being assigned to the testing alias. No production domain was changed.
- Disposable database recheck: 79 passed. Targeted ESLint: no errors (existing
  test/mock typing and image-require warnings remain). Source work is still local,
  not a new committed/pushed checkpoint.

### User-confirmed renewal restoration

- User confirmed Keep Subscription worked on 20 October. Read-only verification
  found the same sandbox subscription active, `cancel_at` cleared, no grace
  period, both members retained, and the unchanged period end of
  19 November 2026 at 08:40 UTC (10:40 South Africa).
- Provider event `evt_01m5cgn05recbyagg3n1yjtsd7` was processed at
  11:20:28 UTC. No agent invoked renewal restoration or created a subscription.
- Live activation remains off. Crew/HOD manual permission testing remains next.
- User requested saving these tested changes to the existing GitHub branch.
  Unrelated local dependency, pricing and security-header edits are excluded.
