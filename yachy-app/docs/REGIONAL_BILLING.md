# Regional billing: implementation and activation gates

Approved 7 October 2026: the six existing USD crew-tier base prices and four billing periods stay unchanged worldwide. VAT/sales tax is added according to the customer's billing address. Percentage discount badges are not displayed.

## Implemented

- The web Vessel Plans and review screens adapt from 320px phones to tablet portrait/landscape and laptop widths. Day/night theme support uses existing controls.
- Customers select their billing country; US/Canada also require a ZIP/postal code. This is not the vessel's current port or device location.
- `preview-paddle-prices` authenticates the current user and verifies Captain/MOV membership of the requested vessel before calling Paddle's read-only pricing preview.
- Every returned plan is checked against the approved catalogue: USD, exact base amount/interval, no regional price overrides, tax mode `external`, quantity one. Tax amounts come from Paddle, never locally maintained rates.
- Country-specific totals and base/tax breakdowns appear before the review step. Missing, failed, mismatched or stale responses cannot enable checkout. Country, billing-period and account changes invalidate prior totals.
- Secure checkout retains the server-created transaction. A short-lived, tab-local billing address/email prefill is passed to Paddle, not used to authorize payment or exemptions. Paddle collects card details and any business tax ID and confirms the final tax/total. Completion events do not grant access; the existing verified webhook remains authoritative.
- Existing subscriptions cannot start a duplicate subscription. Existing trial end dates are preserved.

## Sandbox activation — 7 October 2026

The original rollout omitted the server catalogue/preview switch and the web build's
Paddle environment. All three are required; deploying the screen alone does not
enable tax previews.

- Created and validated 24 sandbox prices against the approved amounts, intervals,
  external tax mode, quantity one and 30-day cardless trials. The older sandbox
  test price and all live prices were left unchanged.
- Verified the real sandbox pricing-preview API through the shared production
  validator for all 24 plans in South Africa, France, the UK, the Bahamas,
  US ZIP 33316 and Canadian postal code M5V 3L9 (144 plan/location checks).
- Configured Supabase `PADDLE_ENV=sandbox`, the verified `PADDLE_PRICE_IDS`,
  `PADDLE_PRICE_PREVIEW_ENABLED=true`, and a sandbox-only key. This temporary key
  expires **6 November 2026** and must be replaced before then if sandbox testing
  continues. It permits catalogue setup and read-only transaction/price previews,
  not transaction creation or subscription changes.
- Configured Vercel `EXPO_PUBLIC_PADDLE_ENV=sandbox`. Environment changes require
  a new web deployment; existing bundles keep their old inlined environment.
- Both server and client checkout flags remain explicitly `false`. No live
  payments, subscriptions, customer records or entitlements were created by these
  preview tests. Browser verification is separate from provider API verification.

Before enabling regional totals:

1. Verify all 24 price IDs in the chosen Paddle environment against the approved schedule. Prices must use `tax_mode: external` with no unit-price overrides. Earlier tax-inclusive/internal prices are intentionally rejected. Do not silently modify live prices.
2. Deploy the `preview-paddle-prices` function and its shared modules alongside the checkout function using the updated shared validator. Configure the matching server-only Paddle API key and price IDs.
3. Set the server-only secret `PADDLE_PRICE_PREVIEW_ENABLED=true` only after the catalogue and preview permissions have been tested. This separate switch does not enable purchases.
4. Verify provider previews for US postal codes, Canada, EU, UK and Caribbean billing addresses, supported-country errors and zero-tax cases in sandbox. Business tax-ID treatment must additionally be verified in checkout before payment activation. Local tests use fixtures, not live tax determinations.

Before enabling checkout:

- Complete the existing cardless-trial payment-collection flow: it must keep the original trial end and not start a second trial, subscription or early charge. That flow is not implemented by this screen change.
- Verify plan changes, proration, existing customer management, verified webhook processing and access updates end to end.
- Confirm both server `PADDLE_CHECKOUT_ENABLED` and client `EXPO_PUBLIC_PADDLE_CHECKOUT_ENABLED` flags, matching environment/client token, approved checkout domain and transaction return validation.
- Reconcile the separate public marketing pricing page with the approved regional-total presentation before launch. This change targets the authenticated Vessel Plans/review screens and secure checkout wrapper, not the marketing site.

## Verification

Run app `npm run typecheck`, `npm test -- --runInBand`, `npm run web:build`, and repository `node --test server/paddle*.test.mjs`.

Responsive layout QA uses isolated local fixtures with the real web billing screen, country picker and shared buttons at widths 320, 390, 768, 820, 1024, 1366 and 1440 in day/night modes. It does not verify a live Paddle transaction, real device keyboards, or payment collection during an existing trial.
