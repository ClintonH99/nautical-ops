# Web pricing page (`/pricing`)

Static page: [`public/pricing.html`](../public/pricing.html). Vercel serves it via rewrite `/pricing` → `/pricing.html` using the repository-root `vercel.json`.

## Payment boundary

The Nautical Ops website is informational and access-only. It must not initialize Paddle, create a Paddle checkout, or collect subscription payment. Captains purchase and manage their vessel subscription in the platform app:

- Apple devices use Apple In-App Purchase.
- Android devices use Google Play Billing.
- Paddle is reserved exclusively for the separate Fleet HQ website.

## Build

Use only the root `vercel.json` with Vercel's Root Directory set to the repository root. The build runs `cd yachy-app && npm run vercel-build`, which exports the Expo web app and copies the static marketing/legal pages into `dist/`.

Local:

```bash
cd yachy-app
npm run web:build
```

No Paddle environment variables belong in the Nautical Ops Vercel project.
