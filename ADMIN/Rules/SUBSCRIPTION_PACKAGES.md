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
   - **Pay with Card (Stripe):** Web checkout; success/cancel deep links back to app.
   - **Subscribe in App (RevenueCat):** Native IAP via App Store / Play Store.

7. **Create Vessel flow:** After vessel creation, do NOT show invite code. Direct Captain to Vessel Settings to choose a plan and pay. Primary CTA: "Go to Vessel Settings."

## Scope

Applies to: VesselSettingsScreen, CreateVesselScreen, CrewManagementScreen, subscription service, Stripe/RevenueCat integrations.
