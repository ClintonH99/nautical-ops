# Subscription setup notes

## Approved payment architecture

- **iPhone and iPad:** Apple In-App Purchase. Apple server verification and App Store Server Notifications update `vessel_subscriptions`.
- **Android:** Google Play Billing. Google server verification and Real-time Developer Notifications must update `vessel_subscriptions`.
- **Nautical Ops web app:** Access-only. It reflects the vessel entitlement purchased through Apple or Google and does not accept subscription payments.
- **Fleet HQ website:** Paddle is reserved exclusively for Fleet HQ and must not be called by Nautical Ops.

`vessel_subscriptions` is the server-side source of truth for vessel access. Client purchase results are never trusted without provider verification.

## Apple setup

The app uses the Apple product IDs in `src/constants/subscriptionPlans.ts` and verifies purchases through `supabase/functions/verify-apple-iap`. Renewal state is refreshed through `supabase/functions/apple-subscription-webhook`.

Required server configuration includes the Apple issuer ID, key ID, private key, bundle ID, and the shared webhook URL secret. Configure App Store Server Notifications to call the deployed Apple webhook.

## Google Play setup

Android support cannot be completed until each subscription and base plan exists in Google Play Console and its exact product ID is recorded in the app. Server verification also requires a Google service account authorized for the Play Developer API, plus Google Real-time Developer Notifications.

Do not copy or guess Apple product IDs unless those exact IDs were deliberately created in Google Play Console.

## Renewal failure behavior

- Normal access continues during the configured 16-day grace period.
- Only provider-confirmed non-payment can start or end the grace period; network failures fail open.
- After grace expires, Crew and HOD users are signed out on app open.
- Captain/MOV stays signed in but is restricted to Vessel Plans.
- Confirmed payment automatically restores normal vessel access.

## Legacy Paddle files

Historical Paddle database columns and old migrations are retained so an already-migrated database remains valid. They are not an approved active payment path. The former Nautical Ops Paddle checkout and webhook functions have been removed from source.
