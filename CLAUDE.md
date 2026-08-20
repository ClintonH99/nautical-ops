# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard rules

- **`CAPTAIN_MOV` and `HOD` are separate, distinct roles — never conflate them.** Check which role(s) each feature actually needs. A grep for `CAPTAIN_MOV` shows where role variables are *declared*, not where they are *enforced*; several screens declare `isHOD` and no longer use it. Verify actual usage in the render/guard path before making any claim about permissions.
- **The only correct project root is `~/Desktop/nautical-ops/`.** Never read from or write to `~/Desktop/Yachy App` (space, capital A) — a stale copy and a recurring source of errors.
- **`.DS_Store` is deliberately left unstaged.** Never commit it, and never `git add -A` / `git add .` without checking what it sweeps in.
- **Fleet HQ (fleethq.nautical-ops.com) is a separate Vercel project in a separate repo.** Do not conflate it with the marketing site served from this repo.
- **Never stack two React Native `Modal`s** — it breaks touch handling on iOS. Conditionally render the different contents inside a single `Modal`.
- **Each `TextInput` inside a Modal needs its own `KeyboardAvoidingView`.** The screen's wrapper does not reach modal layers.
- **Disconnect NordVPN before any EAS command** (`eas build`, `eas submit`, `npm run build:ios`, …) — they fail while it is connected.

## Repository layout

The repo root is a wrapper. Almost all work happens in `yachy-app/`.

- `yachy-app/` — the Nautical Ops app: a single Expo / React Native codebase that ships to iOS, Android **and** the web (nautical-ops.com) from the same source.
- `ADMIN/` — **source of truth** for design, rules and permissions (see below). Read before changing UI, flows or role-based access.
- `app-snapshot-2025-02-25/`, `app-snapshot-2026-02-26/` — frozen historical copies of the app, committed to git. Never edit or "fix" these; they are reference only. Be careful that greps don't lead you into them.
- `yachy-app/nautical-ops-admin/` — a small unrelated Vercel side project, not part of the app build.

## Commands

Run everything from `yachy-app/`.

```bash
npm start                 # Expo dev server (press i / a / w for iOS, Android, web)
npm run start:tunnel      # Expo over ngrok tunnel (physical device on another network)
npm run web               # web dev server

npm run lint              # eslint
npm run typecheck         # tsc --noEmit
npm test                  # jest (jest-expo preset)
npm run format            # prettier --write .

npm run web:build         # production web bundle -> dist/
npm run build:ios         # eas build, production profile
npm run build:android
npm run eas:submit:ios
```

Single test / single case:

```bash
npx jest __tests__/services/auth.test.ts
npx jest -t "signs the user out"
```

CI (`.github/workflows/ci.yml`, on PRs and pushes to `main`) runs, in order: `lint`, `typecheck`, `test`, `npx expo install --check`, `npx expo export --platform ios`, `npm audit --audit-level=critical`. A change that breaks any of these breaks the build. `expo install --check` failing means a dependency version drifted from the one Expo SDK 54 expects — fix with `npx expo install <pkg>`, not by hand-editing `package.json`.

A husky pre-commit hook runs `lint-staged` (prettier + eslint --fix on staged files).

## ADMIN is the source of truth

`.cursor/rules/admin-reference.mdc` makes this mandatory and it applies to Claude Code too: before building, changing or fixing any part of the app, read the relevant file under `ADMIN/`. If ADMIN conflicts with existing code, **ADMIN wins**.

- `ADMIN/App Design/` — fonts, colors, button/card styling. `BUTTON_TAG_STANDARD.md` defines the standard tappable list-card used across every list screen (shape, shadow, typography scale, header/label/value/footer layout) — follow it rather than inventing a new card.
- `ADMIN/Rules/` — ~30 narrow behavioural rules (dark-mode contrast per widget, calendar date handling, search bars, password toggles, vessel-creation flow, subscription packages, role display, …). Grep this folder for the screen or widget you're touching.
- `ADMIN/Authorizations/` — user hierarchy and role permissions.

`.cursor/rules/*.mdc` at the repo root and in `yachy-app/` carry additional binding rules, notably:

- **Post-login routing**: anyone with `user.vesselId` goes straight to Home (`MainTabs`). `CaptainWelcome` / `CreateVessel` is *only* for a captain with no vessel yet. Never route a user who has a `vesselId` into the vessel-creation flow.
- **Permissions**: `CAPTAIN_MOV` has full add / edit / delete access to everything in the app, with no restrictions anywhere, and is never excluded by any rule here. The HOD-only rules constrain crew and HODs, never the captain: Muster Stations are HOD-only for create/edit/delete, and department pre-departure checklists are HOD-only. The Captain's own checklist (`department === null`) is Captain-only — that one excludes HODs, not the captain.
- **Date/time pickers**: `@react-native-community/datetimepicker` with `display="compact"` on iOS (no show/hide state) and a trigger + `display="default"` dialog on Android. Never `inline` or `spinner` on iOS; don't combine `is24Hour` with `compact`.
- Web and native share one Supabase account and the same email/password sign-in.

## Architecture

**Entry**: `index.ts` → `App.tsx` (Sentry wrap, gesture root, decorative font load that deliberately does *not* block render, a hard stop if Supabase env vars are missing) → `src/navigation/RootNavigator.tsx`.

**Navigation** is one native-stack navigator whose contents are swapped wholesale by `isAuthenticated`, keyed so the stack remounts on auth change. There are no per-feature navigators; every screen is registered flat in `RootNavigator`, plus a bottom-tab navigator (`MainTabsNavigator`) for Home / Categories / Profile. Adding a screen means: create it in `src/screens/`, export from `src/screens/index.ts`, register a `Stack.Screen`, and — if it should be linkable on web — add a path to `APP_SCREEN_PATHS` (or `AUTH_SCREEN_PATHS`).

Web deep linking is built by `createWebLinkingConfig`, which keeps **two separate path maps** by auth state so a parsed URL can never target an unmounted screen; unknown or protected URLs fall back to `/login` (logged out) or `/` (logged in).

**Auth bootstrap** (in `RootNavigator`) is tuned for cold-start speed and is easy to break: a returning user is rendered from an AsyncStorage-cached profile (`nautical_ops_cached_user`) immediately, and the network profile fetch happens behind them; the whole bootstrap is raced against a 12s timeout. `useAuthStore.setUser` writes that cache as a side effect. There is a `deferUserUpdate` flag on the auth store — while it is set, neither the auth listener nor realtime sync may call `setUser`, because a remount would destroy an in-progress flow (password reset, vessel creation).

**State**: zustand, all stores in the single file `src/store/index.ts` — `useAuthStore`, `useAppStore`, `useDepartmentColorStore`, `useThemeStore`. Persistence is manual `AsyncStorage` calls inside the store actions, not middleware.

**Theming** is two-mode (`day` / `night`) via `BACKGROUND_THEMES` in the store; screens get colors from `useThemeColors()`, while brand/status/department colors come from `COLORS` in `src/constants/theme.ts`. Department colors have a per-user override layer (`getDepartmentColor(department, overrides)`); the ADMIN dark-mode rules exist because plain `COLORS.*` text is unreadable on the night background — always check `themeColors` for text and surfaces.

**Data access**: `src/services/*.ts`, one module per domain/table, each talking to Supabase directly. Conventions to match:

- Postgres uses `snake_case`, the TypeScript types in `src/types/index.ts` use `camelCase`; each service owns a private `mapRowTo…` mapper. Types are hand-written — there is no generated Supabase schema type.
- Reads generally catch, `console.error`, and return `[]` / `null` rather than throwing, so screens don't need error boundaries.
- Everything is scoped by `vessel_id`; RLS in Supabase enforces vessel membership.

**Realtime**: `src/services/realtimeSync.ts` holds one `app-sync` channel subscribed to the current user's row and their vessel's row, so app and web stay in step. Started/stopped from `RootNavigator` on auth change.

**Roles**: `UserRole = 'HOD' | 'CREW' | 'MANAGEMENT' | 'CAPTAIN_MOV'`. Prefer the helpers in `src/utils/access.ts` (`isMasterOfVessel`, `canAccessVesselManagement`, …). Note some older rules key off `position.toLowerCase().includes('captain')` rather than the role — both patterns exist in the codebase.

**PDF export**: each feature that exports has its own `src/utils/*Pdf.ts` building an HTML string for `expo-print`. Excel import/export goes through `src/services/excelTemplates.ts` and `xlsx`, with the `.xlsx` templates living at the repo root.

## Backend (Supabase)

- **Migrations** in `yachy-app/supabase/migrations/` are ad-hoc SQL files (mostly `CREATE_*`/`ADD_*` names, not timestamped) that are applied **by hand in the Supabase SQL editor**. Most have a matching `RUN_*.md` at `yachy-app/`'s root with paste-ready SQL. When adding a column, add the migration file *and* update the service mapper and the type.
- **Edge functions** in `yachy-app/supabase/functions/` (Deno) cover the things the client must not do: `delete-account`, `delete-vessel`, `leave-vessel`, `send-welcome-email`, `send-trip-push`, Paddle checkout + webhook, Apple IAP verification, and the QR/auth-link flow. They are excluded from the app's `tsconfig.json`.
- Subscriptions are dual-rail: Paddle for web (`create-paddle-checkout` / `paddle-webhook`) and Apple IAP for iOS (`expo-iap` + `verify-apple-iap`), both landing in `vessel_subscriptions`. The subscription **gate** is currently commented out in `RootNavigator` (`TODO: Re-enable subscription check`) — users are not blocked on payment today.

## Configuration and builds

Only `EXPO_PUBLIC_*` vars are inlined into the client bundle (see `.env.example`). Unprefixed vars still work — they just take a different route: `app.config.js` runs in Node at build time, reads them from the environment, and injects them through the config's `extra` field. That is how `POSTHOG_PROJECT_TOKEN` / `POSTHOG_HOST` reach the app, read back at runtime via `expo-constants`. Neither route is private: anything in `extra` ships inside the app bundle and is readable by anyone who inspects it, so only publishable keys belong there — real secrets go in Supabase Edge Function secrets (as the Paddle keys do). For TestFlight/store builds both kinds must be set in expo.dev → Environment variables, not just locally (`docs/EAS_TESTFLIGHT_SUPABASE.md`).

The **web deploy** (Vercel, config at the repo root `vercel.json`) runs `yachy-app`'s `vercel-build`: `inject-pricing-config.mjs` writes `public/pricing-config.js` from env → `expo export --platform web` → `copy-public-to-dist.mjs` copies the static marketing/legal pages into `dist/`. `vercel.json` routes `/` to `landing.html` and `/pricing`, `/privacy-policy`, `/support` etc. to their static pages, with everything else falling through to the SPA `index.html`. Adding a static page means touching `public/`, `copy-public-to-dist.mjs`'s `FILES` list, and `vercel.json`.

Native builds go through EAS (`eas.json`, profiles `development` / `preview` / `production`), with OTA updates on an `appVersion` runtime policy.

## Note on the markdown files

`yachy-app/` contains ~50 loose `.md` files (`SESSION_SUMMARY.md`, `NEXT_AGENT_BRIEF.md`, `FIX_*.md`, `README.md`, `DEVELOPMENT.md`, …). Most are point-in-time notes from past sessions and are **stale** — `README.md` and `DEVELOPMENT.md` still describe trips and inventory as unbuilt. Trust the code, `ADMIN/`, and the `.cursor/rules` over these. The `RUN_*.md` files are the exception and are still the operative instructions for their migrations. **Never trust these files for paths**: several carried executable `cd` commands pointing at the banned stale root `~/Desktop/Yachy App` (four were corrected in `95e4dce`). Check any path in them against the real tree before running it.
