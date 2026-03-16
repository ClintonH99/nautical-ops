# Vercel Deployment Guide

This guide covers deploying the Nautical Ops web app to Vercel and fixing common login issues.

## Prerequisites

- GitHub repo connected to Vercel
- Supabase project (same one used by the mobile app)

## 1. Environment Variables (Required)

The `.env` file is not pushed to GitHub. You must add these variables in Vercel:

1. Go to [Vercel Dashboard](https://vercel.com/dashboard) → your project → **Settings** → **Environment Variables**
2. Add:

| Name | Value | Environments |
|------|-------|--------------|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://grtrcjgsvfsknpnlarxv.supabase.co` | Production, Preview |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Your anon key from Supabase (same as in `.env`) | Production, Preview |

3. Get the anon key from: Supabase Dashboard → **Settings** → **API** → **Project API keys** → `anon` `public`
4. Ensure values match your local `.env` exactly
5. **Redeploy** after adding variables (Deployments → ⋮ → Redeploy)

## 2. Supabase Auth URL Configuration

Supabase must allow requests from your Vercel domain:

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Authentication** → **URL Configuration**
2. Set **Site URL** to your production URL, e.g.:
   - `https://www.nautical-ops.com` or
   - `https://your-project.vercel.app`
3. Add to **Redirect URLs** (one per line):
   ```
   https://www.nautical-ops.com/**
   https://*.vercel.app/**
   https://your-project.vercel.app/**
   ```
4. Save

## 3. Verify Deployment

After redeploying:

1. Open your Vercel URL in a browser
2. Open DevTools (F12) → **Console**
3. Look for: `[Nautical Ops] Supabase URL: https://grtrcjgsvfsknpnlarxv.supabase.co`
   - If you see `https://your-project.supabase.co` → env vars are missing or wrong in Vercel
   - If you see the correct URL → env vars are set; if login still fails, check Supabase URL config (step 2)

## 4. Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Email Address or Password is Incorrect" on web but works on app | Env vars in Vercel are wrong or missing. Add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. |
| App crashes on load with "Supabase is not configured" | Same as above – env vars not set in Vercel. |
| CORS or auth errors in console | Add your Vercel domain to Supabase **Redirect URLs**. |
| Old session / stale data | Try incognito/private window or clear site data. |

## 5. Build Configuration

The project uses `vercel.json` at the repo root:

- **Build command**: `cd yachy-app && npx expo export --platform web`
- **Output**: `yachy-app/dist`
- **Rewrites**: SPA routing (all routes → `index.html`)

No changes needed unless you customize the build.
