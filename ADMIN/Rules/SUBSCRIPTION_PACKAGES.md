# Subscription Packages

## Rule

1. **Captain pays, crew joins free:** The Captain (HOD) is liable for subscription fees. Crew members join under the captain's membership at no additional cost.

2. **Gate before invite code:** The Captain must select and pay for a vessel plan before accessing the invite code. The Invite Code section in Vessel Settings is gated until an active subscription exists.

3. **Plan tiers (crew size, inclusive lower bound):**

   | Tier   | Crew Range | Monthly Price |
   |--------|------------|---------------|
   | 1-5    | 1-5        | $79.99        |
   | 6-10   | 6-10       | $89.99        |
   | 11-15  | 11-15      | $119.99       |
   | 16-25  | 16-25      | $149.99       |
   | 26-40  | 26-40      | $199.99       |
   | 40+    | 41+        | $249.99       |

4. **Billing periods and discounts:**
   - Monthly: no discount
   - 3 months: 5% off per month
   - 6 months: 8% off per month
   - 1 year: 10% off per month

5. **Upgrade warning:** When crew count reaches the plan's max (e.g. 5 crew on 1-5 plan), show a warning to upgrade. Display in Vessel Settings (Vessel Plans) and Crew Management.

6. **Payment options:**
   - **Apple devices:** Subscriptions must use Apple In-App Purchase and Apple's App Store Server API. Do not route Apple-device subscription purchases through Paddle.
   - **Android devices:** Subscriptions must use Google Play Billing and the Google Play Developer API. Do not route Android subscription purchases through Paddle.
   - **Nautical Ops web app:** Reflect the vessel subscription purchased through Apple or Google, but do not process subscription payments on the web.
   - **Fleet HQ website only:** Paddle is reserved exclusively for Fleet HQ. Nautical Ops must not call Paddle checkout or Paddle webhooks.

7. **Create Vessel flow:** After vessel creation, do NOT show invite code. Direct Captain to Vessel Settings to choose a plan and pay. Primary CTA: "Go to Vessel Settings."

8. **Failed renewal and grace period:** This applies only to a vessel that previously had a paid subscription and whose renewal payment was not received.
   - Continue normal access during a **16-day renewal grace period**.
   - A network or backend outage must never be interpreted as non-payment.
   - After grace expires, Crew and HOD are signed out when the app opens and shown exactly: "You have been temporarily logged out from the vessel until the subscription has been paid, apologies for any inconvenience caused."
   - Captain/MOV remains signed in but can access only Vessel Plans until payment is confirmed.
   - Once payment is confirmed, Captain/MOV returns to Home automatically and Crew/HOD can sign in normally.
   - Do not delete vessel data or remove vessel members because of non-payment.
   - Provider webhooks must update subscription state in the background for existing and future subscribers.

9. **Account device limit:** Every account may be registered on a maximum of **two active devices total**, across iOS, Android, and web. This is an account limit, not two devices per platform.

## Scope

Applies to: VesselSettingsScreen, CreateVesselScreen, CrewManagementScreen, subscription service, Apple IAP/App Store Server functions, Google Play Billing/Developer API functions, and Nautical Ops web access checks. Paddle is outside this app's scope.
