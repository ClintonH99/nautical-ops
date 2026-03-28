# Web pricing page (`/pricing`)

Static page: [`public/pricing.html`](../public/pricing.html). Vercel serves it via rewrite `/pricing` → `/pricing.html` (see repo root [`vercel.json`](../../vercel.json)).

## Build

Use **only** the root `vercel.json` (Vercel **Root Directory** = repository root, not `yachy-app`). The build runs `cd yachy-app && npm run vercel-build`, which:

1. `node scripts/inject-pricing-config.mjs` — writes [`public/pricing-config.js`](../public/pricing-config.js) from env
2. `npx expo export --platform web`
3. `node scripts/copy-public-to-dist.mjs` — copies HTML + `pricing-config.js` into `dist/` (guaranteed on CI)

Local:

```bash
cd yachy-app
npm run web:build
```

## Environment variables (Vercel)

Set for the **Production** (and Preview if needed) environment:

| Variable                          | Purpose                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`        | Supabase project URL                                                              |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`   | Supabase anon key (public)                                                        |
| `EXPO_PUBLIC_PADDLE_CLIENT_TOKEN` | Paddle **client-side** token from Paddle Dashboard (sandbox `test_…` for sandbox) |

`inject-pricing-config.mjs` also accepts `SUPABASE_URL`, `SUPABASE_ANON_KEY`, or `PADDLE_CLIENT_TOKEN` as fallbacks.

## Auth from the app

**Activate Vessel Plan** opens a Supabase magic link. After redirect, the pricing page completes the session using:

- PKCE `code` (query)
- `access_token` / `refresh_token` (hash)
- `token` or `token_hash` (query) with `verifyOtp`

Ensure **Supabase Auth → URL configuration** allows redirect to `https://nautical-ops.com/pricing` (and `www` / Vercel preview if used).

## Paddle

- Sandbox: `Paddle.Environment.set('sandbox')` is set in the page; use a **sandbox** client-side token.
- Success UI uses the Paddle.js `checkout.completed` event (user stays on nautical-ops.com).

## Webhook

Checkout sends `custom_data`: `vessel_id`, `user_id`, `plan_tier`, `billing_period` — aligned with [`supabase/functions/paddle-webhook`](../supabase/functions/paddle-webhook/index.ts).
