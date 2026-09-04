# Nautical Ops — Handover

Written 2026-08-23 against commit `03b65eb`. Every figure was checked against the repo, not recalled. Where something is unverified it says so explicitly.

**This is not exhaustive.** Section 11 lists exactly what remains unread. Treat that list as the boundary of what can be trusted here.

Read alongside `CLAUDE.md` (rules and architecture). This document covers current state, defects, and traps that have cost real time.

---

## 1. Where things are

**The only correct app root is `~/Desktop/Nautical Ops/nautical-ops/`.** All work happens in its `yachy-app/` subdirectory.

A stale duplicate sits at `~/Desktop/Nautical Ops/Yachy App/`, pointing at the same GitHub remote. Because both live under the same parent, a relative search from `~/Desktop/Nautical Ops/` returns `yachy-app/` **twice**. Confirm which you are in with `git -C <path> rev-parse --show-toplevel`.

| Directory                | Remote                             | What it is                                |
| ------------------------ | ---------------------------------- | ----------------------------------------- |
| `nautical-ops/`          | `ClintonH99/nautical-ops`          | **The app**                               |
| `nautical-ops-admin/`    | `ClintonH99/nautical-ops-admin`    | Static admin site + Vercel functions      |
| `nautical-ops-fleet-hq/` | `ClintonH99/nautical-ops-fleet-hq` | Separate product, separate Vercel project |
| `nautical-ops-website/`  | `ClintonH99/nautical-ops-website`  | Marketing site                            |
| `nautical-ops-images/`   | none                               | Assets, not a repo                        |
| `Yachy App/`             | same as app                        | **Stale duplicate — do not touch**        |

An empty `~/Desktop/nautical-ops/` (lowercase) also exists, containing only `.claude/`. A shell started there fails every command with `ENOENT ... posix_spawn '/bin/sh'` — that error means _the working directory is gone_, not that the shell is broken. It cost an hour on 2026-08-20.

---

## 2. Size and health

|                             |         |
| --------------------------- | ------- |
| Screens                     | **83**  |
| Components                  | 17      |
| Services                    | 31      |
| PDF utils                   | 13      |
| Source lines                | ~44,000 |
| **Test files**              | **7**   |
| Active migrations           | 11      |
| Historical SQL scripts      | 41      |
| Edge functions              | 11      |
| ADMIN rule files            | 30      |
| `.cursor/rules` files       | 8       |
| Loose `.md` in `yachy-app/` | **61**  |

**Typecheck: 3 errors**, all pre-existing:

- `AddEditUniformScreen.tsx` — invalid `Size` key in `StyleSheet.create`. Cosmetic.
- `iap.ts` ×2 — `fetchProducts` can return `null` but is typed `Product[]`; `PurchaseError` imported from two module paths giving two type identities. **This is the payments file.**

**Lint: 2 errors, 317 warnings.** Both errors are empty `catch {}` in `InfoModal.tsx`. Warnings are mostly unused imports and `any`.

**Tests: 42 passing across 7 files.** Coverage now includes authentication,
subscription gating, Apple IAP handling, account/device access, spreadsheet
import bounds, and native/web file uploads. This is still not complete coverage
for an app of this size.

**Biggest files:** `AddEditMaintenanceLogScreen` 1050, `ProfileScreen` 1026, `MaintenanceLogScreen` 904, `CreateWatchTimetableScreen` 852, `CrewManagementScreen` 808, `auth.ts` 721.

---

## 3. Known defects — unfixed

**Resolved in production: `vessel-banners` exists.** The live metadata audit on
2026-09-03 confirmed `vessel-banners` and `profile-photos` are public buckets.
Their legacy write policies are too broad; the working-tree storage migration
restricts profile writes to the owner and banner writes to the vessel Captain.

**Resolved in the working tree: React Native local-file uploads could hang forever.** The old `fetch(uri).blob() -> Response(blob).arrayBuffer()` path behaved differently in Expo Go and TestFlight. Vessel-banner and profile-photo uploads now share `utils/fileUpload.ts`: native builds read bytes through Expo FileSystem, while web keeps its supported fetch path. Three regression tests cover native, web, and unreadable-file behavior. The live `vessel-banners` bucket is still required separately.

**Resolved in the working tree: silent zero-row writes.** Update/delete
services now request affected IDs and throw when RLS or a stale ID changes zero
rows, instead of showing false success.

**Subscription gate implemented in the working tree.** `RootNavigator` now enforces provider-confirmed renewal failure after the 16-day grace period while failing open for connectivity/backend uncertainty. The migration and provider notification function are not deployed yet.

---

## 4. ADMIN rule violations — confirmed

Update after the original handover: the six violations below were approved for correction. Export labels and dark-mode styling, Profile/Register department dropdowns, and the instant-startup rule are now being brought into alignment; verify the current Git diff and latest commit before treating them as released.

Resolution implemented in the working tree:

- Shared PDF controls now say **Export to PDF**, including selected-item counts.
- Shared Export and Edit-color pills use white text and borders in Night mode.
- Hand-written Edit controls in Watch Duties, Watch Schedule, Watch Schedule Detail, and Maintenance Log use white in Night mode.
- Profile and standard registration now use the shared labelled department dropdown. `RegisterCrewScreen` remains the documented multi-select exception.
- `WELCOME_SCREEN_ON_APP_OPEN.md` now records the approved instant-startup behaviour instead of requiring an artificial three-second delay.

Next dark-mode audit findings (not fixed in this change):

- The shared `Input` component uses `COLORS.gray400` for ordinary placeholders in Night mode instead of `themeColors.textSecondary`.
- Nine form screens contain custom inputs with hardcoded gray/tertiary placeholder colours.
- Profile, Vessel Settings, Add/Edit Uniform, FAQ Help, Add/Edit Maintenance, and parts of Create Safety Equipment use `themeColors.background` for custom form inputs where `DARK_MODE_TEXT_BOXES.md` requires `themeColors.surface`.
- A broader static scan found many hardcoded navy or dark text styles. Each occurrence still needs render-path inspection because some are on light or coloured surfaces and are not automatically violations.

`ADMIN/` is the documented source of truth and **wins over existing code** (`.cursor/rules/admin-reference.mdc` makes this binding). All 30 rule statements were read. Six confirmed violations:

**1. Export buttons say the wrong thing — introduced 2026-08-22.**
`DARK_MODE_EXPORT_PDF.md`: _"All PDF export buttons must say **Export to PDF**"_. The shared `ExportButton` renders `⤓ Export`. Affects **14+ screens**.

**2. Export buttons are the wrong colour in Dark Mode — introduced 2026-08-22.**
Same rule: _"In Dark Mode: button text and border must be **white**"_. `ExportButton` uses `COLORS.primary` (navy) in both themes.

**3. `PillButton` likewise — introduced 2026-08-22.**
`DARK_MODE_EDIT_BUTTONS.md`: buttons saying "Edit" (including "Edit colors") must be white in Dark Mode. `PillButton` defaults to `COLORS.primary` regardless of theme. Used for "Edit colors" on four trip screens.

**4. `ProfileScreen`'s department dropdown was missed — 2026-08-22.**
`DEPARTMENT_SELECTION_DROPDOWN.md` names `ProfileScreen`. The rollout converted 16 screens to `LabeledDropdown` and missed it, so "applied everywhere" is inaccurate.

**Pre-existing, not from that work:**

**5. `RegisterScreen` uses department button toggles.** The rule permits toggles only for `RegisterCrewScreen` (multi-select). Looked at on 2026-08-22 and deliberately left, without checking for a governing rule.

**6. The Welcome screen never shows on cold start.** `WELCOME_SCREEN_ON_APP_OPEN.md` requires it every cold start, then routing by auth state after ~3s. `RootNavigator:235` computes `initialRoute` as only `Login` / `CaptainWelcome` / `MainTabs`. `WelcomeScreen` is registered but never the initial route. Predates 2026-08-21.

**Six violations surfaced from reading 30 rule statements and spot-checking five files. A full audit will likely find more** — the dark-mode rules in particular (`DARK_MODE_TITLES`, `DARK_MODE_LABELS_HINTS`, `DARK_MODE_TEXT_BOXES`, `NIGHT_MODE_TEXT_WHITE`, `DARK_MODE_FUEL_TOTAL`, `DARK_MODE_DOWNLOAD_TEMPLATE`) were never checked against the code.

---

## 5. The 30 ADMIN rules, by area

**Design/theme:** `AUTH_SCREEN_INPUT_STYLE`, `BOARD_DESIGN_UNITY`, `SEARCH_BARS`, `CALENDARS`, `DARK_MODE_TITLES`, `DARK_MODE_LABELS_HINTS`, `DARK_MODE_TEXT_BOXES`, `DARK_MODE_EDIT_BUTTONS`, `DARK_MODE_EXPORT_PDF`, `DARK_MODE_FUEL_TOTAL`, `DARK_MODE_DOWNLOAD_TEMPLATE`, `NIGHT_MODE_TEXT_WHITE`

**Departments:** `DEPARTMENT_COLOR_TAGS` (display tags = coloured background), `DEPARTMENT_DROPDOWN_STYLE` (selection controls = plain text, no colour), `DEPARTMENT_SELECTION_DROPDOWN` (must be dropdown, not toggles)

**Auth/onboarding:** `WELCOME_SCREEN_ON_APP_OPEN`, `CAPTAIN_WELCOME_SCREEN_ACCESS`, `CAPTAIN_VESSEL_CREATION_FLOW`, `VESSEL_CREATION_SUCCESS_SCREEN`, `CREW_POST_REGISTRATION_ROUTING`, `DUPLICATE_EMAIL_PROMPT`, `LOGIN_CREDENTIALS_ERROR_PROMPT`, `PASSWORD_VISIBILITY_TOGGLE`

**Permissions/roles:** `SAFETY_EQUIPMENT_PERMISSIONS`, `ROLE_DISPLAY`, `SUBSCRIPTION_PACKAGES`

**Data:** `CALENDAR_TRIP_DATES` (no timezone shift — selecting 1 July must never show 30 June), `DEFAULT_VESSEL_BANNER`

**Tooling:** `QR_CODE_EXPO_START`

Also binding, at repo root and in `yachy-app/`: `.cursor/rules/` — `admin-reference`, `post-login-routing`, `muster-station-permissions`, `pre-departure-checklist-permissions`, `shopping-list-department-display`, `web-sign-in`, `date-time-picker`, `plan-usage-reminder`.

---

## 6. Edge functions (11 live, including 2 obsolete)

| Function                     | Purpose                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| `verify-apple-iap`           | Verify Apple IAP via App Store Server API                            |
| `apple-subscription-webhook` | Refresh Apple subscription state from App Store Server Notifications |
| `delete-account`             | Delete a user account entirely                                       |
| `delete-vessel`              | Delete a vessel (Captain/MOV only)                                   |
| `leave-vessel`               | Leave a vessel without deleting it                                   |
| `send-welcome-email`         | Welcome/subscription emails via Resend                               |
| `send-trip-push`             | Trip push notifications                                              |
| `create-auth-code`           | One-time auth code for QR sign-in                                    |
| `claim-auth-link`            | Claim an auth code with the app session                              |
| `get-auth-link`              | Web polls this for the action link; one-time use                     |

Deno, excluded from the app's `tsconfig`. The payment functions have now been audited. The approved payment split is Apple IAP on iOS and Google Play Billing on Android; Nautical Ops web is access-only. Paddle is reserved exclusively for the separate Fleet HQ website. The old Nautical Ops Paddle checkout and webhook sources and live deployments still exist for compatibility. They are obsolete for this app and require a separate approved production cleanup after confirming no legacy billing remains.

---

## 7. What changed 2026-08-21/22 (34 commits)

Verify with `git log --oneline --since=2026-08-21`.

**Monitoring — was entirely non-functional.** Sentry and PostHog were coded correctly but their keys lived only in gitignored `.env.local`, which EAS never uploads, so every build ran with both silently disabled. Keys now in `eas.json` (preview + production); `SENTRY_AUTH_TOKEN` in EAS's encrypted store for source maps. **Verified receiving** via a test event. **Not verified** from a real device.

**Bug fixes**

- IAP purchase listener never fired — guarded on `purchase.transactionReceipt`, absent in expo-iap 4.3.1. Normal purchases unaffected; interrupted ones were charged without activating. **Untested on device.**
- PostHog never called `reset()` on logout — shared-device attribution bug.
- Signatures opened the wrong tab (`'drawn'` vs `'draw'`).
- `Vessel` type missing `imoNumber`.
- Captain signup hang (section 3).

**Behaviour**

- Trips and yard periods opened to all crew.
- Nine access messages said "Only HODs" where code allowed HOD **or** Captain. `isHOD` renamed to `canManageTrips` / `canEditTripColors`.

**Design** — `PageHeader` on all 71 screens that had a native header (iOS 26 draws a Liquid Glass circle behind nav-bar controls; `react-native-screens` 4.16 offers no opt-out). `ExportButton`/`ExportBar` on 14 screens. `LabeledDropdown` on 16. `ButtonTagCard` collapsible on 6 — **tapping a card now expands rather than opening Edit**, the biggest habit change. Muster Station and Safety Equipment exports moved to the header with new multi-record PDF functions.

**Dependencies** — 11 packages to Expo SDK 54.0.37.

---

## 8. Traps that have bitten

**`eas submit --latest` means latest _finished_, not latest started.** Submitting mid-build silently grabs the previous binary. Happened three times. Always confirm with `eas build:list` first.

**EAS builds from committed git state.** Uncommitted work isn't in the binary.

**Version numbers can't be reused.** Apple rejected build 41 (`ITMS-90186`, `ITMS-90062`) because 1.0.5 was approved. Bump `expo.version` before rebuilding; `runtimeVersion` follows it, so each version is a separate OTA channel.

**CLAUDE.md describes a CI pipeline that does not exist.** There is no `.github/workflows/`.

**Expo Go is not a valid test for files, assets, storage or native modules.** It runs different code from a production build. The signup hang is the proof.

**The 61 loose `.md` files are mostly stale.** `README.md` and `DEVELOPMENT.md` describe built features as unbuilt. `RUN_*.md` are the exception and remain operative.

---

## 9. Deployment and credentials

EAS profiles `development` / `preview` / `production`. `appVersionSource: remote` — EAS owns build numbers, `app.json` owns the version string.

```bash
eas build --profile production --platform ios
eas submit --profile production --platform ios --latest   # only after "finished"
```

Currently **v1.1.3, build 45**, in TestFlight. Credentials on EAS (ASC API key `PGAC84Y8Z4`). **~80% of the EAS free plan used this month — builds are scarce.**

Admin site: Vercel, `vercel.json` v2, catch-all `/(.*)` must stay last, single shared password via `x-admin-password`, no rate limiting.

| Credential              | Prefix          | Lives in                    | Job                          |
| ----------------------- | --------------- | --------------------------- | ---------------------------- |
| Sentry DSN              | `https://b423…` | `eas.json`                  | Sends errors out. Write-only |
| `SENTRY_AUTH_TOKEN`     | `sntrys_`       | EAS encrypted store         | Source map upload            |
| `SENTRY_READ_TOKEN`     | `sntryu_`       | admin `.env.local` + Vercel | Admin dashboard reads        |
| `POSTHOG_PROJECT_TOKEN` | `phc_`          | `eas.json`                  | Analytics. Public write key  |

Unprefixed vars reach the app via `app.config.js` → `extra` → `expo-constants`. Anything in `extra` ships inside the binary and is readable — publishable keys only. Real secrets go in Supabase Edge Function secrets.

---

## 10. Untested on a device

Across five builds, none of these has been exercised:

1. **A sandbox purchase** — the listener fix is unverified and is the only change touching money
2. **Sentry reporting from a real phone** — confirmed only from a test event sent from a Mac
3. **PostHog after a login**
4. **Trips as a non-HOD crew member**
5. **Collapsible cards** on the six list screens

---

## 11. What is NOT covered here

The boundary of what this document can be trusted on:

- **~63 of the 83 screens** have not been read in any depth — only touched by scripted edits
- The 41 historical untimestamped SQL scripts are retained for reference but are not active migrations. The production schema baseline and all later timestamped public-schema migrations were read and replayed in a clean disposable database.
- **All 11 edge functions** unread beyond header comments — including all three payment functions
- **The database schema** is unknown beyond `users`, `vessels`, `vessel_subscriptions`, and tables glimpsed through services
- **25 of 30 ADMIN rules** were read as one-line statements only, not compared against the code
- **All 8 `.cursor/rules`** unread
- **Fleet HQ and the website repo** never opened
- **RLS policies** never inspected; behaviour inferred from HTTP responses
- **No performance, accessibility or security review** has been done

---

## 12. Where to start

1. **Audit all 30 ADMIN rules against the code.** Six violations surfaced from statements alone; a real audit will find more. This tells you how far the documented standard and the app have drifted — the single most valuable thing to know.
2. **Fix the four violations from 2026-08-22** — three are one-line changes in `ExportButton` and `PillButton`; the fourth is `ProfileScreen`'s dropdown.
3. **Fix `uploadBannerImage` at source**, then create the `vessel-banners` bucket.
4. **Add affected-row checks** to delete/update handlers — silent no-ops are invisible today.
5. **Read `iap.ts` and the three payment edge functions.** Two of the three typecheck errors are there, and it handles money.
6. **Test coverage** — one file for 44,000 lines. Services are the highest-value target.
7. **Archive the 61 stale `.md` files** — they actively mislead.
8. **Split the 1000-line screens.**

The structural reason behind "I change something and it breaks something else" is that 83 screens each carried their own copies of layout, styles and patterns. The 2026-08-21/22 work pulled the header, export controls, department row and card behaviour into shared components. That direction is right — each thing extracted is one fewer place to break — but note it also introduced four rule violations in one pass, because the shared components were written without reading the rules that governed them. **Extract, but read `ADMIN/` first.**

---

## 13. Audit continuation — 2026-09-03

This section records findings from the continued audit and their current working-tree status. None of these changes is released until it is committed, pushed, built, and—where applicable—deployed to Supabase.

### Dark mode

- **Resolved in the working tree:** `Button.tsx` now makes outline/text controls white in Night mode.
- **Resolved in the working tree:** ordinary `Input.tsx` placeholders now use `themeColors.textSecondary` in Night mode; fixed-light and search fields retain their intentional gray placeholders.
- **Resolved in the working tree:** `ConsentCheckbox` links and `InfoModal` bullets are readable in Night mode.
- **Resolved in the working tree:** the audited custom form inputs use dark surfaces and theme-aware placeholders.
- **Resolved in the working tree:** generated Watch Timetable rows use the current theme surface instead of hardcoded white.
- **Remaining:** the broader static scan contains many hardcoded colors. Each must be checked against its actual rendered surface; not every hardcoded color is a defect.

### Authentication and onboarding

- **Resolved in the working tree:** Login, Register Captain, Register Crew, and Create Vessel pass `forceLight` to their shared inputs.
- Captain/Crew post-registration routing and Captain-without-vessel routing match the governing rules.
- Password visibility toggles are present on the checked password fields.
- The exact invalid-login and duplicate-email messages are implemented in `auth.ts`.
- **Resolved in the working tree:** first-launch Login is no longer blocked on a network profile request, and `WelcomeScreen` has no artificial three-second delay. Returning users with a cached profile still render immediately while Supabase refreshes behind the UI.
- **Resolved in the working tree:** the vessel-success view uses the fixed maritime palette and states that the invite code is accessible from Settings.

### Permissions and database enforcement

- **Resolved in the working tree:** Captain/MOV and HOD can create, edit, and delete all Muster Stations and all pre-departure checklists, including the All Departments checklist. The `.cursor` rules now match this policy, and a new always-applied Captain full-access rule prevents future HOD-only regressions.
- Safety Equipment screen guards match its HOD/Captain/Crew matrix.
- **Resolved in the working tree:** Profile and Settings display MOV when either the secure role is `CAPTAIN_MOV` or a legacy profile position contains `captain`. Access control continues to use the role, not editable display text.
- **Deployed but not activated:** the role, subscription, device and server-enforcement migrations are present in production. The strict server-enforcement switch remains off until a compatible build is released and tested, preventing older installed builds from being locked out.
- **Remaining:** other checked-in RLS policies generally enforce vessel membership only, not feature-specific roles. Their product permissions must be confirmed before tightening them.
- **Resolved in the working tree:** the production `public` schema is captured in a schema-only baseline with no customer rows or webhook credentials. It includes the previously missing client-used tables and passed a clean PostgreSQL replay followed by every timestamped migration. The 41 old untimestamped SQL files were moved to `supabase/legacy-migrations/` because Supabase CLI silently skipped them. Storage remains covered by its dedicated timestamped migration and separate policy test.

### Subscriptions and payments

- **Resolved in the working tree:** one payment architecture is now documented consistently: Apple IAP on iOS, Google Play Billing on Android, no payment processing in Nautical Ops web, and Paddle only in Fleet HQ.
- **Resolved in the working tree:** the renewal gate now gives all users normal access through a 16-day grace period; after provider-confirmed expiry, Crew/HOD are signed out and Captain/MOV is restricted to Vessel Plans until payment is confirmed. Connectivity failures fail open.
- **Resolved in the working tree:** Apple transactions are bound to a vessel, bundle/expiry checks are performed server-side, and App Store Server Notifications can refresh renewal state in the background.
- **Production foundation verified:** the subscription/security migrations are deployed; `verify-apple-iap`, `apple-subscription-webhook`, and `delete-vessel` are active; the Apple secrets and App Store notification URL are configured; and Apple Billing Grace Period is set to 16 days for Production and Sandbox.
- **Resolved in the working tree:** sign-out is local to the current device, Apple restore now verifies restored transactions server-side before reporting success, duplicate StoreKit callbacks are deduplicated, and plans display the App Store's localized price rather than a hardcoded USD value.
- **Verified locally:** 42 unit tests pass. The exact production migrations also passed a disposable PostgreSQL test covering the two-device cap, renewal grace, Captain payment recovery access, Crew lockout, normal-data lockout, stale-provider fail-open handling, and revocation.
- **Remaining rollout:** build and test a compatible iOS release, make it available to all users, and only then enable strict server enforcement. It is currently confirmed off in production.
- **Remaining Android implementation:** Google Play subscriptions/base plans, exact product IDs, service-account credentials, server verification, and Real-time Developer Notifications are not yet configured. No IDs will be guessed.
- **Remaining legacy cleanup:** historical Paddle database columns/migrations remain intentionally. The obsolete `create-paddle-checkout` and `paddle-webhook` functions and Paddle secrets are also still active in the Nautical Ops Supabase project. Their removal requires explicit production approval and confirmation that no legacy vessel still depends on them.
- **Pricing decision required:** the rule lists 5%, 8%, and 10% multi-month discounts, while code labels every `discountPercent` as zero. The 11–15 monthly price is `$119.99` in the rule and `$119.00` in code/App Store Connect. App Store Connect also currently shows a free-first-month introductory offer for this product. Runtime display now uses StoreKit's authoritative localized price, but the commercial terms and documentation still need the owner's decision.
- Provider webhook integration tests still need to be added.

### Dependency security

- **Resolved in the working tree:** SheetJS was upgraded from the vulnerable npm release `xlsx@0.18.5` to the official patched `xlsx@0.20.3` package distributed by SheetJS. Spreadsheet imports now stop before parsing files larger than 10 MB or 5,000 rows.
- **Resolved in the working tree:** `eas-cli` was updated to 23.2.0, and patched `shell-quote`/`tar` overrides remove all critical npm advisories. Expo SDK 54 dependencies still match Expo's expected versions.
- **Remaining:** npm reports 42 low/moderate/high advisories, all transitive. Several are in EAS CLI/build tooling; the runtime Metro advisories require an Expo 57 upgrade. npm's proposed `--force` repair would introduce breaking downgrades/upgrades and must not be used in this release.

### Verification after the fixes

- `npm run typecheck`: passes with zero errors.
- `npm test -- --runInBand`: all 42 tests pass across seven suites.
- `npm run lint -- --quiet`: passes with zero errors after including Node `.mjs` build scripts in the ESLint configuration. The broader lint run still reports 342 warnings.
- `npx expo install --check`: dependencies match Expo SDK 54's expected versions using the online registry check.
- `npx expo export --platform ios`: all 2,687 modules bundle successfully into the production iOS export.
- `npm audit --audit-level=critical`: passes with zero critical advisories.
- `git diff --check`: passes.

### Data integrity and backend security

- **Resolved in the working tree:** client updates/deletes now detect database
  writes that affected zero rows instead of reporting success after RLS denial
  or a stale record ID.
- **Resolved in the working tree:** vessel leave/delete and account-deletion
  preparation are database transactions. Partial moves no longer strand users
  between vessels, and account deletion correctly allows one Captain to leave
  when another Captain remains.
- **Resolved in the working tree:** an Apple purchase token is consumed in the
  same transaction that records the subscription. Concurrent verification
  cannot reuse one token for another transaction chain.
- **Resolved in the working tree:** QR codes use cryptographic randomness and
  claim/consume links atomically. Arbitrary Vercel preview origins are no longer
  trusted, malformed codes are rejected, and raw server errors are not returned.
- **Resolved in the working tree:** trip-push and welcome-email handlers require
  a server credential. Welcome-email user/vessel strings are HTML-escaped, and
  push logs no longer reveal token prefixes.
- **Verified:** all database transaction and privilege cases pass in a
  disposable PostgreSQL 15 container, including rollback behavior, sole-Captain
  safeguards, Paddle blocking, one-time QR use, one-time Apple token use, and
  denial of privileged RPCs to anon/authenticated roles.
- **Production check:** all three Database Webhooks use a service credential.
  No live setting was changed. The new migrations/functions remain undeployed
  and must follow the order in `docs/SECURITY_ENFORCEMENT_ROLLOUT.md`.
- **Live storage finding:** profile-photo and vessel-banner writes were open to
  every authenticated account regardless of path ownership. A verified
  migration now limits profile writes to the matching user folder, banner
  writes to the matching vessel Captain, and both buckets to 10 MB objects.
  This migration was applied directly to production on 2026-09-04; all policy,
  helper-permission and size-limit metadata checks passed afterward. A normal
  user/Captain upload-and-delete smoke test remains part of rollout QA.
- **Dependency audit:** the SDK 54 dependency set passes Expo's compatibility
  check and the app has no critical npm advisory. Remaining inherited
  high/moderate advisories require a breaking Expo SDK upgrade; do not run the
  automated forced downgrade/upgrade suggested by npm.
- **Staged subscription privacy fix:** clean installs now deny app clients
  direct reads of `vessel_subscriptions`; the app uses a safe RPC projection
  that omits Apple/Google transaction identifiers. Production must make the
  same `REVOKE SELECT` change only after the compatible app version is released.
