# Nautical Ops — Handover

Written 2026-08-23. Everything here was verified against the repo at commit `e82d391`, not recalled from memory. Where something is unverified, it says so.

Read `CLAUDE.md` first — it holds the hard rules and architecture. This document covers what that file doesn't: current state, known defects, and the traps that have actually bitten.

---

## 1. Where things are

**The only correct app root is `~/Desktop/Nautical Ops/nautical-ops/`.**

There is a stale duplicate at `~/Desktop/Nautical Ops/Yachy App/` pointing at the same GitHub remote. It is not the working copy. Because both sit under the same parent, a relative search from `~/Desktop/Nautical Ops/` returns `yachy-app/` **twice**. Confirm which you are in with `git -C <path> rev-parse --show-toplevel` before acting on any path.

| Directory | Remote | What it is |
|---|---|---|
| `nautical-ops/` | `ClintonH99/nautical-ops` | **The app.** All work happens in `yachy-app/` |
| `nautical-ops-admin/` | `ClintonH99/nautical-ops-admin` | Static admin site + Vercel serverless functions |
| `nautical-ops-fleet-hq/` | `ClintonH99/nautical-ops-fleet-hq` | Separate product, separate Vercel project |
| `nautical-ops-website/` | `ClintonH99/nautical-ops-website` | Marketing site |
| `nautical-ops-images/` | none | Image assets, not a repo |
| `Yachy App/` | same as app | **Stale duplicate — do not touch** |

There is also an empty `~/Desktop/nautical-ops/` (lowercase, hyphen) containing only `.claude/`. A shell started there fails every command with `ENOENT ... posix_spawn '/bin/sh'`, which means *the working directory does not exist* — not that the shell is broken. That error cost an hour on 2026-08-20.

---

## 2. Size and health

| | |
|---|---|
| Screens | **83** |
| Components | 15 |
| Services | 31 |
| PDF utils | 13 |
| Source lines | ~44,000 |
| **Test files** | **1** |
| Migrations | 42 |
| Edge functions | 11 |
| Loose `.md` files in `yachy-app/` | **61** |

**Typecheck: 3 errors.** All pre-existing, none blocking:
- `AddEditUniformScreen.tsx` — a `Size` key inside `StyleSheet.create` that isn't a valid style property. Cosmetic.
- `iap.ts` ×2 — `fetchProducts` can return `null` but is assigned to `Product[]`; and `PurchaseError` is imported from two different module paths, giving two type identities. **This is the payments file — treat with care.**

**Lint: 2 errors, 317 warnings.** Both errors are empty `catch {}` blocks in `InfoModal.tsx`. The warnings are overwhelmingly unused imports and `any`.

**Tests: 10 passing, 1 file.** That is the entire suite for 44,000 lines. `__tests__/services/auth.test.ts`. Note the passing test for `validateInviteCode` passes somewhat by accident — its Supabase mock returns a vessel object where a subscription is expected, so `plan_tier` is undefined and the crew-limit branch is skipped. It no longer crashes, but it isn't really exercising the logic.

**Largest files, as refactor candidates:** `AddEditMaintenanceLogScreen` (1050), `ProfileScreen` (1026), `MaintenanceLogScreen` (904), `CreateWatchTimetableScreen` (852), `CrewManagementScreen` (808), `auth.ts` (721).

---

## 3. Known defects — unfixed

**`vessel-banners` storage bucket does not exist.** Verified: `GET /storage/v1/bucket/vessel-banners` returns `404 NoSuchBucket`. `ADMIN/Rules/DEFAULT_VESSEL_BANNER.md` requires the default banner to be uploaded there on vessel creation. That upload therefore fails on every single signup. Nobody notices because `HomeScreen` falls back to the bundled asset. **Fix is to create the bucket (public) in Supabase — no code change.**

**`uploadBannerImage` can hang forever on React Native.** In `services/vessel.ts`:
```js
const blob = await response.blob();
const arrayBuffer = await new Response(blob).arrayBuffer();
```
RN's fetch polyfill does not reliably implement this; the promise can never settle. Not reject — *never settle*, so `try/catch` is useless against it.

This caused Captain signup to hang indefinitely on TestFlight while working fine in Expo Go, because in Expo Go the asset is served over HTTP by Metro and in a production build it is a local `file://` path — a different code path entirely.

`CreateVesselScreen` now works around it by not awaiting the upload. **The underlying method is still dangerous** and is also called from `VesselSettingsScreen` (user picks a vessel photo), where there is no such workaround. `services/user.ts:343` notes the avatar upload "mirrors" the same approach, so it likely shares the bug. **This should be fixed at source.**

**Supabase reports success for writes that affect zero rows.** A `PATCH` or `DELETE` that RLS silently refuses returns `HTTP 200/204` with an empty array and **no error**. Verified directly. Every delete handler in this app checks `error`, which stays `null`. If a delete ever appears not to work, this is why. Nothing currently checks affected-row counts.

**Subscription gate is disabled.** `RootNavigator` has `// TODO: Re-enable subscription check`. Users are not blocked on payment today.

---

## 4. What changed on 2026-08-21/22 (32 commits)

Verify any of this with `git log --oneline --since=2026-08-21`.

**Monitoring — was completely non-functional, now works**
Sentry and PostHog were correctly coded but their keys lived only in gitignored `.env.local`, which EAS does not upload. Every build ever made ran with both silently disabled. Keys are now in `eas.json` (`preview` + `production`); `SENTRY_AUTH_TOKEN` is in EAS's encrypted store attached to both environments, so source maps upload and stack traces are readable. **Verified receiving**: a test event was sent and appeared in Sentry. **Not yet verified**: that a real device reports — no crash has occurred since.

**Bug fixes**
- IAP purchase listener never fired — guarded on `purchase.transactionReceipt`, which doesn't exist in expo-iap 4.3.1, so the condition was always false. Normal purchases were unaffected (the direct return value is used) but interrupted purchases — plausible at sea — were charged without activating. **Untested on a device.**
- PostHog never called `reset()` on logout, so on a shared device the next person's actions were attributed to the previous user.
- Saved signatures opened the wrong tab (`'drawn'` vs `'draw'` mismatch).
- `Vessel` type was missing `imoNumber`, which the service already mapped.

**Behaviour**
- Trips and yard periods opened to all crew (were HOD/Captain only).
- Nine access-denied messages said "Only HODs" where the code allowed HOD **or** Captain. Now "Only HODs and Captain have access." The variable was named `isHOD` but meant "HOD or Captain" — renamed to `canManageTrips` / `canEditTripColors`.

**Design — this touched nearly everything**
- `PageHeader` replaces the native navigation bar on **all 71 screens** that had one. Reason: iOS 26 draws a Liquid Glass circle behind anything in the native nav bar, and `react-native-screens` 4.16 exposes no opt-out. Owning the header sidesteps it.
- `ExportButton` + `ExportBar` standardise export across 14 screens: tap Export → selection mode → checkboxes → confirm with count.
- `LabeledDropdown` standardises the department row on 16 screens.
- `ButtonTagCard` gained opt-in collapsible support; six list screens now collapse to a summary and expand on tap. **Tapping a card no longer opens the edit screen** — that moved to the Edit button. Biggest habit change for users.
- Muster Station and Safety Equipment exports moved from per-card buttons to the header, with new multi-record PDF functions.

**Dependencies** — 11 packages aligned to Expo SDK 54.0.37.

---

## 5. Traps that have actually bitten

**`--latest` on `eas submit` means latest *finished*, not latest started.** Submitting while a build is still compiling silently grabs the previous binary. This happened three times. Always confirm status/version with `eas build:list` before submitting.

**EAS builds from committed git state.** Uncommitted changes are not in the binary. A build was nearly wasted this way.

**Version numbers cannot be reused.** Apple rejected build 41 with `ITMS-90186` and `ITMS-90062` because 1.0.5 was already approved. Bump `expo.version` in `app.json` before rebuilding. `runtimeVersion` follows `appVersion`, so each version is a separate OTA channel.

**CLAUDE.md describes a CI pipeline that does not exist.** There is no `.github/workflows/`. Nothing is gated on push.

**Expo Go is not a valid test for anything touching files, assets, storage, or native modules.** It runs materially different code from a production build. The signup hang is the proof. Layout and logic are fine to check there; file handling is not.

**`ADMIN/` is the documented source of truth** for design and permissions, and wins over existing code. `ADMIN/App Design/BUTTON_TAG_STANDARD.md` defines the list card; `ADMIN/Rules/` holds ~30 behavioural rules; `ADMIN/Authorizations/` holds role permissions. Read the relevant file before changing UI or access.

**The 61 loose `.md` files in `yachy-app/` are mostly stale** point-in-time session notes. `README.md` and `DEVELOPMENT.md` still describe built features as unbuilt. Do not trust them for paths — several carried `cd` commands pointing at directories that no longer exist. `RUN_*.md` are the exception and remain operative for their migrations.

---

## 6. Deployment

**App** — EAS, profiles `development` / `preview` / `production`. `appVersionSource: remote`, so EAS owns the build number; `expo.version` in `app.json` owns the version string.

```bash
eas build --profile production --platform ios
eas submit --profile production --platform ios --latest   # only after the build reports finished
```

Currently: **v1.1.3, build 45**, submitted to TestFlight. Credentials are on EAS (App Store Connect API key `PGAC84Y8Z4`), so neither command prompts. The account is at ~80% of the EAS free plan for the month — builds are a scarce resource.

**Admin site** — Vercel, `vercel.json` v2 with explicit `builds`/`routes`. The catch-all `/(.*)` must stay last. Auth is a single shared password via the `x-admin-password` header; no rate limiting. Recently added `api/sentry.js` + an Errors panel reading the Sentry API server-side.

**Web** — Vercel, from the same Expo source via `vercel-build`.

---

## 7. Credentials — which is which

Four Sentry/analytics credentials exist and are easy to confuse:

| Credential | Prefix | Lives in | Job |
|---|---|---|---|
| Sentry DSN | `https://b423…` | `eas.json` → the app | Sends errors **out**. Write-only, safe in the binary |
| `SENTRY_AUTH_TOKEN` | `sntrys_` | EAS encrypted store | Uploads source maps at build time |
| `SENTRY_READ_TOKEN` | `sntryu_` | admin `.env.local` + Vercel | Pulls errors **into** the admin dashboard |
| `POSTHOG_PROJECT_TOKEN` | `phc_` | `eas.json` | Analytics. Public write key |

Unprefixed vars reach the app via `app.config.js` → `extra` → `expo-constants`. Anything in `extra` ships inside the binary and is readable — only publishable keys belong there. Real secrets go in Supabase Edge Function secrets.

---

## 8. Untested — the honest list

None of these has been exercised on a device, across five builds:

1. **A sandbox purchase.** The purchase-listener fix is unverified and is the only change touching money.
2. **Sentry reporting from a real phone.** Confirmed receiving from a test event; not confirmed from the app.
3. **PostHog after a login.** Should produce `user_signed_in` with the user identified.
4. **Trips as a non-HOD crew member.**
5. **Collapsible cards** on the six list screens.

---

## 9. If I were picking up this codebase

In priority order, and each small enough to verify:

1. **Fix `uploadBannerImage` at source** — the hang can still bite in Vessel Settings and probably avatars. Then create the `vessel-banners` bucket.
2. **Add affected-row checks to delete/update handlers** — silent no-ops are invisible today.
3. **Look hard at `iap.ts`** — 2 of the 3 typecheck errors are there, and it handles money.
4. **Test coverage** — one test file for 44,000 lines. The services are the highest-value target.
5. **Delete or archive the 61 stale `.md` files** — they actively mislead.
6. **Split the 1000-line screens.**

The structural problem behind "I change something and it breaks something else" is mostly this: 83 screens each carrying their own copies of layout, styles, and patterns. The work on 2026-08-21/22 pulled the page header, export controls, department row, and card behaviour into shared components — that direction is worth continuing, because each thing extracted is one fewer place to break.
