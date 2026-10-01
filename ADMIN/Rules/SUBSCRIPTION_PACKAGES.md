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

4. **Billing periods and discounts:**
   - Monthly: no discount
   - 3 months: 5% off per month
   - 6 months: 8% off per month
   - 1 year: 10% off per month

5. **Upgrade warning:** When crew count reaches the plan's max (e.g. 5 crew on 1-5 plan), show a warning to upgrade. Display in Vessel Settings (Vessel Plans) and Crew Management.

6. **Payment options:**
   - **Approved pivot, 1 October 2026:** Nautical Ops is moving to a mobile-first web app. Paddle is the sole intended payment provider for Nautical Ops and the future yacht-management interface. Do not create further iOS/Android builds or add StoreKit/Google purchase flows.
   - The owner confirmed all Apple subscriptions are sandbox tests. Preserve accounts, vessels, records and Sea Miles; archive test billing metadata recoverably at cutover, not by deleting user data.
   - The 24 prices above are approved. Apply the period calculations internally but **never display percentage-discount labels**. Show the full billing-period amount.
   - Enable checkout only after Paddle price IDs, USD amounts, intervals, tax treatment, checkout domain and signed webhook delivery have been verified. The server foundation is deployed but checkout is explicitly disabled pending those checks.

7. **Create Vessel flow:** After vessel creation, do NOT show invite code. Primary CTA: "Go to Home." Home shows a welcome board with Continue and See Plans; See Plans opens Vessel Plans. Only a server-verified Paddle subscription changes entitlement. Keep checkout disabled for unverified products; do not infer activation from a browser success callback. Upgrade/downgrade timing must be confirmed before enabling plan changes.

8. **Failed renewal and grace period:** This applies only to a vessel that previously had a paid subscription and whose renewal payment was not received.
   - Continue normal access during a **16-day renewal grace period**.
   - A network or backend outage must never be interpreted as non-payment.
   - After grace expires, Crew and HOD are signed out when the app opens and shown exactly: "You have been temporarily logged out from the vessel until the subscription has been paid, apologies for any inconvenience caused."
   - Captain/MOV remains signed in but can access only Vessel Plans until payment is confirmed.
   - Once payment is confirmed, Captain/MOV returns to Home automatically and Crew/HOD can sign in normally.
   - Do not delete vessel data or remove vessel members because of non-payment.
   - Explicit departure recovery: Leave Vessel belongs on the payment-lockout screen, **not the ordinary login screen**, per the subsequent approved correction. Crew/HOD may voluntarily leave an unpaid vessel through the existing server-verified departure flow, retaining My Sea Miles and moving to a private Crew account. Payment-restricted Captain/MOV users go to See Plans with payment/reactivation and subscription management options, not Leave Vessel. Cancellation alone does not restore access or remove members. The last Captain/MOV safeguard remains unchanged for normal in-app departures. Recovery does not unlock unpaid vessel records or bypass the device limit.
   - Provider webhooks must update subscription state in the background for existing and future subscribers.

9. **Account device limit:** Every account may be registered on a maximum of **two active devices total**, across iOS, Android, and web. This is an account limit, not two devices per platform.

## Scope

Applies to Vessel Settings, vessel creation, Crew Management, the subscription service, Paddle billing functions and web access checks. Native billing code remains legacy until the web replacement and recoverable cutover are verified; retaining old migrations does not authorize new native purchases.
