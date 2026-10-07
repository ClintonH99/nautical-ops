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

## Not activated by this code change

No remote catalogue, Supabase deployment, live payment setting or production deployment is changed by this implementation.

Before enabling regional totals:

1. Verify all 24 price IDs in the chosen Paddle environment against the approved schedule. Prices must use `tax_mode: external` with no unit-price overrides. Earlier tax-inclusive/internal prices are intentionally rejected. Do not silently modify live prices.
2. Deploy the `preview-paddle-prices` function and its shared modules alongside the checkout function using the updated shared validator. Configure the matching server-only Paddle API key and price IDs.
3. Set the server-only secret `PADDLE_PRICE_PREVIEW_ENABLED=true` only after the catalogue and preview permissions have been tested. This separate switch does not enable purchases.
4. Verify live-provider previews for US postal codes, Canada, EU, UK and Caribbean billing addresses, supported-country errors, zero-tax cases and validated business tax IDs in sandbox. Local tests use fixtures, not live tax determinations.

Before enabling checkout:

- Complete the existing cardless-trial payment-collection flow: it must keep the original trial end and not start a second trial, subscription or early charge. That flow is not implemented by this screen change.
- Verify plan changes, proration, existing customer management, verified webhook processing and access updates end to end.
- Confirm both server `PADDLE_CHECKOUT_ENABLED` and client `EXPO_PUBLIC_PADDLE_CHECKOUT_ENABLED` flags, matching environment/client token, approved checkout domain and transaction return validation.
- Reconcile the separate public marketing pricing page with the approved regional-total presentation before launch. This change targets the authenticated Vessel Plans/review screens and secure checkout wrapper, not the marketing site.

## Verification

Run app `npm run typecheck`, `npm test -- --runInBand`, `npm run web:build`, and repository `node --test server/paddle*.test.mjs`.

Responsive layout QA uses isolated local fixtures with the real web billing screen, country picker and shared buttons at widths 320, 390, 768, 820, 1024, 1366 and 1440 in day/night modes. It does not verify a live Paddle transaction, real device keyboards, or payment collection during an existing trial.
