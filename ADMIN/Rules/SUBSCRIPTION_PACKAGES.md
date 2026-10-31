# Subscription Packages

## Rule

1. **Captain pays, crew joins free:** The Captain/MOV is liable for subscription fees. Crew members and HODs join under the captain's vessel subscription at no additional cost.

2. **Gate before invite code:** The Captain must select and pay for a vessel plan before accessing the invite code. The Invite Code section in Vessel Settings is gated until an active subscription exists.

3. **Plan tiers (crew size, inclusive lower bound):**

   | Tier  | Crew Range | Monthly Price |
   | ----- | ---------- | ------------- |
   | 1-5   | 1-5        | $79.99        |
   | 6-10  | 6-10       | $89.99        |
   | 11-15 | 11-15      | $119.99       |
   | 16-25 | 16-25      | $149.99       |
   | 26-40 | 26-40      | $199.99       |
   | 40+   | 41+        | $249.99       |

4. **Exact Paddle prices — approved 29 October 2026:**
   The founder selected the existing live Paddle catalogue as the authority for
   all web prices. This supersedes the former 5% / 8% / 10% calculations. Use
   these exact USD base totals for the full billing period, not a derived discount:

   | Crew | Monthly | 3 months | 6 months | Yearly |
   | --- | ---: | ---: | ---: | ---: |
   | 1–5 | $79.99 | $229.99 | $449.99 | $869.99 |
   | 6–10 | $89.99 | $259.99 | $499.99 | $979.99 |
   | 11–15 | $119.99 | $349.99 | $669.99 | $1,299.99 |
   | 16–25 | $149.99 | $429.99 | $829.99 | $1,619.99 |
   | 26–40 | $199.99 | $569.99 | $1,109.99 | $2,159.99 |
   | 40+ | $249.99 | $719.99 | $1,379.99 | $2,699.99 |

   Keep the marketing pages, Vessel Plans, regional-preview validation and
   server purchase validation aligned. Catalogue-parity tests cover all 24
   combinations. Paddle changes must be reviewed and synchronized; do not
   silently accept an arbitrary provider or browser amount. Tax remains
   provider-calculated and the 30-day trial is unchanged. This pricing approval
   does not waive the live activation checks below. A sandbox catalogue using
   the old totals will deliberately fail validation until aligned separately.

5. **Upgrade warning:** When crew count reaches the plan's max (e.g. 5 crew on 1-5 plan), show a warning to upgrade. Display in Vessel Settings (Vessel Plans) and Crew Management.

6. **Payment options:**
   - **Approved pivot, 1 October 2026:** Nautical Ops is moving to a mobile-first web app. Paddle is the sole intended payment provider for Nautical Ops and the future yacht-management interface. Do not create further iOS/Android builds or add StoreKit/Google purchase flows.
   - The owner confirmed all Apple subscriptions are sandbox tests. Preserve accounts, vessels, records and Sea Miles; archive test billing metadata recoverably at cutover, not by deleting user data.
   - The 24 exact Paddle prices above are approved. Do not calculate percentage discounts or display percentage-discount labels. Show the full billing-period amount.
   - Enable checkout only after Paddle price IDs, USD amounts, intervals, tax treatment, checkout domain and signed webhook delivery have been verified. The server foundation is deployed but checkout is explicitly disabled pending those checks.

7. **Create Vessel flow:** After vessel creation, do NOT show invite code. Primary CTA: "Go to Home." Home shows a welcome board with Continue and See Plans; See Plans opens Vessel Plans. Only a server-verified Paddle subscription changes entitlement. Keep checkout disabled for unverified products; do not infer activation from a browser success callback.

   **Confirmed 6 October 2026 (tax treatment superseded below):** Keep the 30-day free trial. All plan changes, including downgrades and billing-period changes, take effect immediately. Preview the provider-calculated prorated charge/credit before confirmation; never grant a higher crew limit from a client callback. Do not reset the trial when changing an existing plan. Do not silently remove crew to fit a smaller plan. Live activation still requires successful sandbox tests and verified catalogue/configuration.

   **Approved 7 October 2026 regional pricing design:** Keep all 24 USD base prices identical worldwide with explicit Paddle `tax_mode: external`, no country price overrides. Use Paddle pricing previews for regional tax and display the calculated full billing-period total prominently, including EU VAT where applicable. Country selection means the buyer's billing country, not the vessel's current port. Ask for ZIP/postal code where needed for local tax. Never display a failed/pending tax lookup as zero tax or a base price as a final total. Paddle checkout validates final address/tax-ID treatment. All billing pages must adapt to mobile, tablet/iPad portrait and landscape, and laptop, with touch/keyboard access and no clipped controls. Existing cardless-trial payment collection remains blocked until its server flow is verified; the UI must not start another subscription or reset the trial. No live payment activation is authorized by design approval alone.

   **Approved 19 October 2026 plan-card presentation:** Show the price in larger bold text with a smaller billing-period suffix, without "before tax", "excl. tax" or a tax breakdown inside each crew-size card. Above the cards, show one small, readable grey note: "Tax/VAT is calculated at checkout based on your billing region." Preserve provider-calculated regional totals, the tax-inclusive preview notice and the separate billing-summary breakdown. This is a presentation change only; payment amounts, tax calculations and access/recovery behaviour remain unchanged.

   **Confirmed 7 October 2026:** Start the 30-day trial without payment details. When 14 days or fewer remain, show Captain/MOV a dismissible in-app billing reminder with Continue and See Plans. Continue preserves normal access through the existing trial expiry and does not start payment. Dismissal is scoped to the user, vessel and trial. Adding payment details during the trial must preserve its original end date; do not call Paddle's early-activation operation or charge before expiry. This reminder is not a paywall and must not appear for Crew/HOD, paid/canceled plans or an unconfirmed subscription state. Cardless trial creation and payment-method collection require Paddle's dedicated server/API flow; the older checkout entry point is not a substitute.

   **Approved 12 October 2026 optional payment step:** After server confirmation of a new cardless trial, offer "Set up billing details" and "Continue without payment details". Show the confirmed plan, original trial end/first payment date, zero due today and the regional tax-inclusive recurring preview. Skipping goes to Home without calling payment setup. Adding details uses only the existing trial's zero-value payment-method transaction, never a new subscription, a restarted trial or early activation. Make setup errors visible beside the action. The same step is available from the current plan for adding details later. Existing 14-day reminders stay unchanged. This is sandbox/test-preview work; live payments remain disabled.

   **Approved 13 October 2026 checkout design:** Use a white, navy-branded checkout page with Paddle's inline secure form, a two-column laptop layout and stacked phone/tablet layout. Populate items, billing frequency, subtotal, tax, discounts, credits, amount due and recurring totals from Paddle checkout events, not hard-coded examples or URL amounts. Preserve the existing transaction and the server-confirmed trial end date; if date context is unavailable, direct the user to the date shown in Paddle rather than starting a new 30-day period. Card fields stay entirely inside Paddle's iframe. Keep its complete legal footer visible, retain a refund-policy link, show recoverable loading/error states and return to Vessel Plans for server verification after completion. Never grant entitlement from a checkout callback. Styling approval does not authorize enabling live payments.

   **Approved 19 October 2026 wallet checkout:** Present Apple Pay/Google Pay where supported, retaining Paddle's secure card-entry fallback and full legal footer. Use the inline **one-page** variant: actual sandbox verification rejected express with "Cardless trial subscriptions are only supported by one-page checkout variant." This also affected the existing subscription's payment-method update. Verify the exact preview domain for Apple Pay so supported Safari can open the native wallet without Paddle's extra handoff page; verification is currently blocked by Vercel SSO protecting the association file, and protection must not be disabled without explicit approval. Preview/sandbox only; do not enable live payments. A `flow=payment-method` URL flag is presentation intent only: it never changes the transaction, price, dates, or entitlement. Show update-specific copy only with matching Paddle zero-value recurring totals, and do not infer an active trial from a price's catalogue `trial_period`. Show existing trial dates only from recent transaction-bound server-response context. After a matching completed event, show a branded confirmation and the actual reported payment method, without asserting vessel access is restored; Return to Nautical Ops goes through Vessel Plans' server checks. Apple controls the native wallet appearance.

   **Approved 20 October 2026 sandbox subscription management:** After confirmed cancellation, show “Renewal cancelled” and the access-end date instead of the redundant Manage Subscription button. Keep Refresh Plan Status available. Before an active/trialing subscription's scheduled cancellation takes effect, offer Captain/MOV a Keep Subscription action: read the bound provider subscription first, then require a separate Confirm Renewal action (Leave Cancelled must perform no mutation). Remove only the scheduled cancellation, retaining the same subscription, plan, original trial if applicable and billing date; do not charge early, start another trial, or grant access from the client response. Webhooks remain authoritative. Do not retry ambiguous mutations automatically. An already canceled/expired provider subscription needs a separate re-subscription flow and is not covered by this action. This approval is for test/preview first; live release requires later approval.

8. **Failed renewal and grace period:** This applies only to a vessel that previously had a paid subscription and whose renewal payment was not received.
   - **Approved 30 October 2026 expired-trial recovery:** At the confirmed end of a Paddle trial, Captain/MOV is restricted to Vessel Plans and crew access is blocked until payment is confirmed. No first-payment grace or second trial. Preserve vessel records and memberships. For a provider-confirmed canceled subscription, Reactivate Subscription prepares a new, paid-only checkout for the same vessel/customer and current plan. Keep the original billing history. An abandoned/failed checkout or saved card must not unlock access. Bind the replacement only after a signed provider event and server-verified completed transaction; delayed old-subscription events cannot overwrite it. Paid-only catalogue entries must match the approved amounts/intervals/tax/quantity, with no trial. Local implementation is not approval to modify the live catalogue or deploy.
   - Continue normal access during a **16-day renewal grace period**.
   - A network or backend outage must never be interpreted as non-payment.
   - After grace expires, Crew and HOD are signed out when the app opens and shown exactly: "You have been temporarily logged out from the vessel until the subscription has been paid, apologies for any inconvenience caused."
   - Captain/MOV remains signed in but can access only Vessel Plans until payment is confirmed.
   - Once payment is confirmed, Captain/MOV returns to Home automatically and Crew/HOD can sign in normally.
   - Do not delete vessel data or remove vessel members because of non-payment.
   - Explicit departure recovery: Leave Vessel belongs on the payment-lockout screen, **not the ordinary login screen**, per the subsequent approved correction. Crew/HOD may voluntarily leave an unpaid vessel through the existing server-verified departure flow, retaining My Sea Miles and moving to a private Crew account. Payment-restricted Captain/MOV users go to See Plans with payment/reactivation and subscription management options, not Leave Vessel. Cancellation alone does not restore access or remove members. The last Captain/MOV safeguard remains unchanged for normal in-app departures. Recovery does not unlock unpaid vessel records or bypass the device limit.
   - Provider webhooks must update subscription state in the background for existing and future subscribers.

9. **Account device limit:** Every account may be registered on a maximum of **two active devices total**, across iOS, Android, and web. This is an account limit, not two devices per platform.
   - **Final approval 15 October 2026, supersedes the one-hour experiment below:** Save at most two browser installations per account indefinitely. Closing, sleeping or backgrounding a browser does not release its slot. Explicit Sign Out releases only that browser; verified replacement or approved-device removal revokes the removed session before admitting a replacement. Normal authentication expiry/security checks remain enforced. Keep stable browser identities, server-side serialized registration/revocation and the authenticated recovery gate. Never merge by browser label/IP or claim physical-device identification. Deploy this policy after tests; preserve accounts, vessels and history. At cutover, retire only already-expired reservations from opted-in one-hour test accounts so expired test history does not become extra permanent slots.
   - **Approved 15 October 2026, supersedes permanent saved-device limits when enabled:** Enforce two concurrent browser-installation sessions per account. A visible, connected app renews its server-issued slot; reading without clicking still counts as active. Hidden/suspended/closed browsers do not renew. A slot expires one hour after its last successful foreground check-in, without signing the user out or deleting registration history. Returning users reacquire a free slot automatically; if both are occupied, keep authentication and block protected access with an active-session waiting/recovery screen. Explicit removal still revokes the old session. No third-slot grace. Database/RLS and sensitive-action checks must enforce expiry independently of UI. Same browser/profile tabs reuse the existing identity; this is NOT a guarantee of two physical devices. Build/test first, with server-only per-account opt-in and no production-wide activation without approval.
   - **Confirmed 14 October 2026:** Repeated visits and sign-ins from the same saved browser must reuse its device slot. Preserve its installation identifier across releases, serialize creation during simultaneous startup checks, and restore it from a persistent host-only cookie if local storage alone is lost. Never claim a slot using an identifier that cannot be saved. Browser/device labels must distinguish examples such as Safari on iPhone and Chrome on Mac; labels are descriptive and must never authorize access or merge devices. Separate browser profiles, private browsing and separate website origins have separate storage; loss of both persistent copies still requires the existing device-recovery flow. The server continues to enforce two active devices and reject revoked sessions.

## Scope

Applies to Vessel Settings, vessel creation, Crew Management, the subscription service, Paddle billing functions and web access checks. Native billing code remains legacy until the web replacement and recoverable cutover are verified; retaining old migrations does not authorize new native purchases.
