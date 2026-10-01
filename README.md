# Nautical Ops

Mobile-first web application, with Supabase for accounts and vessel data and Paddle as the intended sole billing provider. Native release work is retired; shared Expo/React Native Web code remains in use.

## Web migration checkpoint (1 October 2026)

These changes are local and are **not a completed production migration**:

- Web-specific Vessel Plans screen, with all 24 approved USD prices and no percentage-discount labels. Checkout is deliberately disabled until Paddle catalogue and entitlement verification are complete.
- Web PDF transport uses `POST /api/export-pdf`, authenticates the Supabase user and registered device, renders embedded HTML without scripts or external requests, then applies the existing shared PDF header/page-number system. Report contents and calculations are unchanged.
- Browser drawing canvas replaces the unsupported native WebView signature pad. The stored signature remains a PNG.
- OAuth popup completion runs at web startup. Browser CORS support wraps the existing authenticated leave-vessel/delete-account/delete-vessel handlers without changing their permissions.
- CI builds the web bundle rather than an iOS bundle. Native purchase reconciliation is excluded from the web bundle.
- Paddle server foundation now includes Captain/device-checked checkout reservations, exact catalogue validation, signed webhooks and transactional replay/order protection. The additive migration and functions remain local; checkout is still disabled. See `yachy-app/SUBSCRIPTION_SETUP_NOTES.md` for configuration and cutover blockers.

### Local checks

From this repository root: `npm ci && npm test` (Node 22.17+).
From `yachy-app`: `npm ci`, `npm run typecheck`, `npm test -- --runInBand`, `npm run lint`, `npm run web:build`.

The optional PDF rendering smoke test uses synthetic records:
`CHROME_EXECUTABLE=/path/to/chrome node server/pdf-smoke.mjs /tmp/nautical-pdf-check`
It checks a 31-day landscape Hours of Rest report, a one-page short report and a multipage report. The PDFs should also be visually inspected.

### Deployment prerequisites

- Vercel must install both root server dependencies and `yachy-app` dependencies, use Node 22, and expose the PDF function before the new PDF client is released. Static-only Expo hosting cannot run this function.
- The function needs `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the corresponding `EXPO_PUBLIC_` names are also supported). It does **not** need a service-role key. Generated documents are processed transiently; no document bodies or tokens are logged.
- Configure deployment-level rate limiting for `/api/export-pdf` before public release. The code only bounds request/output size, rendering duration and per-instance concurrency; it is not a distributed quota system.
- Deploy and check the three account-action functions separately; local source changes do not update deployed Supabase functions. The welcome-email endpoint is server-only and intentionally does not receive browser CORS support.

### Remaining release blockers

1. Validate all 24 prices, billing intervals, tax treatment and environment-specific price IDs in Paddle. Complete the payment page, subscription management, pending-checkout reconciliation and end-to-end tests before enabling payments. Local safeguards alone do not validate Paddle configuration.
2. Align database and client entitlement enforcement, including cancellation dates and expiry. Archive sandbox Apple billing metadata recoverably at cutover; do not delete accounts, vessels or personal Sea Miles.
3. Implement browser push delivery with a service worker and preserve the existing notification recipients/preferences.
4. Complete browser device replacement/recovery while keeping the strict two-session limit. Clearing browser storage must not be presented as a new physical-device detection guarantee.
5. Verify production TLS from real devices, authenticated browser workflows and the Linux/Vercel PDF renderer. Local rendering is not proof of production readiness.
6. Finish native-only dependency/release-file cleanup and public Apple-specific copy after replacement paths are verified. Improve bundle loading and responsive styling in the next mobile-first pass.

No live subscription or operational records were changed by this checkpoint.
