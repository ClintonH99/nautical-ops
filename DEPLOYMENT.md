# Auto-Deploy to nautical-ops.com

Push to GitHub → website updates automatically. Here’s how to set it up.

## One-time setup: Connect Vercel to GitHub

1. **Go to [vercel.com](https://vercel.com)** and sign in (or create an account).

2. **Import your repo**
   - Click **Add New…** → **Project**
   - Import the **nautical-ops** repo (or your main project repo)
   - Select the GitHub org/account that owns the repo

3. **Configure the project**
   - **Framework Preset**: Other (Expo is custom)
   - **Root Directory**: `.` (project root)
   - **Build Command**: `cd yachy-app && npx expo export --platform web` (or leave default – `vercel.json` defines it)
   - **Output Directory**: `yachy-app/dist` (or leave default – `vercel.json` defines it)

4. **Add environment variables**
   - In Vercel project settings → **Environment Variables**, add:
     - `EXPO_PUBLIC_SUPABASE_URL` = your Supabase project URL
     - `EXPO_PUBLIC_SUPABASE_ANON_KEY` = your Supabase anon key
   - Apply these for **Production**, **Preview**, and **Development**

5. **Deploy**
   - Click **Deploy**
   - After deployment, Vercel gives you a URL (e.g. `nautical-ops.vercel.app`)

6. **Use your own domain**
   - In project settings → **Domains**, add `www.nautical-ops.com` (and `nautical-ops.com` if needed)
   - Follow Vercel’s instructions to point DNS to Vercel

## How auto-deploy works

- Every push to `main` triggers a new deployment.
- Every push to other branches creates a preview deployment.
- The website at nautical-ops.com will reflect the latest code after each deploy.

## Check that it’s set up correctly

- `vercel.json` in the project root configures install, build, and output.
- Ensure your Supabase **Site URL** and **Redirect URLs** include `https://www.nautical-ops.com` (see `yachy-app/WEB_DEPLOYMENT_SETUP.md`).

## Troubleshooting: "Sign in with QR code" not generating

If the QR code page shows "Generating QR code…" forever or an error:

1. **Add Vercel env vars** (required for production): Vercel → Settings → Environment Variables → add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, then **Redeploy**.

2. **Deploy Supabase Edge Functions**: `cd yachy-app && supabase functions deploy create-auth-code get-auth-link claim-auth-link`

3. **Ensure `auth_links` table exists** in Supabase (run `supabase/migrations/CREATE_AUTH_LINKS_TABLE.sql`).
