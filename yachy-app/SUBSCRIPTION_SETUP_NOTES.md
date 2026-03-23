# Subscription setup notes

## Payment methods

1. **Activate Vessel Plan (mobile app)** — Opens the system browser with a **magic link** (via `create-auth-code` → `claim-auth-link` → `get-auth-link`) so the user lands signed in on **https://nautical-ops.com/pricing** to complete purchase on the web.
2. **Web checkout** — **Paddle Billing** on nautical-ops.com; webhooks update Supabase.

Supabase table `vessel_subscriptions` is the source of truth for access. Paddle webhooks keep it updated after web checkout.

## Auth link flow (app → pricing)

Edge functions (deploy as needed):

- **`create-auth-code`** — Creates a short-lived row in `auth_links`; returns `{ code }`.
- **`claim-auth-link`** — Authenticated user POSTs `code` and `redirect_to` (e.g. `https://nautical-ops.com/pricing`); stores Supabase `action_link` on the row.
- **`get-auth-link`** — POST `{ code }`; returns `{ action_link }` once (then deletes the row). The app opens this URL with `Linking.openURL`.

## Paddle (card checkout on web)

### Supabase Edge Functions

- **`create-paddle-checkout`** — Used by the website (or tooling), not the mobile pay buttons.
- **`paddle-webhook`** — Receives Paddle notifications; verifies `Paddle-Signature`; upserts `vessel_subscriptions`.

Deploy (from `yachy-app` with Supabase CLI linked):

```bash
supabase functions deploy create-paddle-checkout
supabase functions deploy paddle-webhook --no-verify-jwt
```

`paddle-webhook` is called by Paddle only — use `--no-verify-jwt` so the gateway does not require a Supabase JWT.

### Secrets (Supabase Dashboard → Edge Functions → Secrets)

| Name                    | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `PADDLE_API_KEY`        | Server API key from Paddle (sandbox or live)     |
| `PADDLE_WEBHOOK_SECRET` | Signing secret for your webhook destination      |
| `PADDLE_ENV`            | `sandbox` (default) or `live` — selects API host |

### Price IDs

Mapped in [`src/constants/subscriptionPlans.ts`](src/constants/subscriptionPlans.ts) (`PADDLE_PRICE_IDS`) and duplicated in the Edge Function for server-side resolution.

### Database

Run migration [`supabase/migrations/20260322120000_vessel_subscriptions_paddle.sql`](supabase/migrations/20260322120000_vessel_subscriptions_paddle.sql) (adds `paddle_*`, removes `stripe_*`).

## Testing

- Use **Paddle Sandbox** first (`PADDLE_ENV=sandbox`).
- After checkout on the web, confirm `vessel_subscriptions` updates via webhook (check Supabase logs and Paddle notification delivery).
- Test **Activate Vessel Plan** on device: confirm all three auth-link functions deploy and the browser opens the magic link.
