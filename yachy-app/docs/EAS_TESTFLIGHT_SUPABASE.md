# Supabase for EAS builds & TestFlight

`EXPO_PUBLIC_*` variables are **inlined when the native app is built**. Local `.env` is **not** used on EAS Build servers unless the same variables are defined for your project.

**EAS Update (OTA) cannot fix missing Supabase config** — you need a **new `eas build`** after setting variables.

---

## Your checklist (step by step)

### 1. Open Expo dashboard

1. Go to [expo.dev](https://expo.dev) and sign in.
2. Open your project (**Nautical Ops** / slug `nautical-ops`).
3. Go to **Environment variables** (under project settings; exact label may be **Secrets** / **Env** depending on Expo UI version).

### 2. Add two variables for production builds

Create these **exact names** (case-sensitive):

| Name                            | Value                                              |
| ------------------------------- | -------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`      | Your Supabase **Project URL** (Settings → API)     |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase **anon public** key (Settings → API) |

**Environment scope:** assign them to the **`production`** environment (or **all** environments if your UI offers that and your production profile uses it). They must be available when EAS runs a build with profile **`production`** (see `eas.json`).

**Visibility:** `EXPO_PUBLIC_*` values are embedded in the client bundle; treat the anon key as non-secret for client use (RLS still protects your data).

### 3. Trigger a new iOS build

From the `yachy-app` folder on your machine:

```bash
cd yachy-app
npx eas-cli build --platform ios --profile production
```

Wait until the build **finishes successfully**.

### 4. Submit the new build to App Store Connect

```bash
npx eas-cli submit --platform ios --profile production --latest
```

Or upload the `.ipa` manually via Transporter / Xcode Organizer.

### 5. TestFlight

1. In **App Store Connect** → your app → **TestFlight**, wait until the new build finishes **processing**.
2. Add the build to your **internal** (or external) testing group if needed.
3. Open **TestFlight** on your iPhone, update/install the new build, and launch the app.

You should get past the **Configuration Required** screen once this build is installed.

---

## Optional: Android

Same variables apply. After setting them in Expo:

```bash
npx eas-cli build --platform android --profile production
npx eas-cli submit --platform android --profile production --latest
```

---

## Verify locally before shipping

Your local `.env` (from `.env.example`) should match what you put in Expo so dev and production behave the same.

## References

- [Expo: Environment variables in EAS](https://docs.expo.dev/eas/environment-variables/)
- `SUPABASE_SETUP.md` — Supabase project setup
- `src/services/supabase.ts` — where these env vars are read
