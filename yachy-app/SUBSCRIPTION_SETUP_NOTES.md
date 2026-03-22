# Subscription setup notes

## Payment methods

1. **Pay with Card** — **Paddle Billing** (hosted checkout in the system browser).
2. **Subscribe via App Store** — **RevenueCat** / native IAP (unchanged).

Supabase table `vessel_subscriptions` is the source of truth for access. Paddle webhooks and RevenueCat (if wired to backend later) should keep it updated.

## Paddle (card checkout)

### Supabase Edge Functions

- **`create-paddle-checkout`** — Authenticated users POST `vesselId`, `planTier`, `billingPeriod`; returns `{ url }` for Paddle hosted checkout.
- **`paddle-webhook`** — Receives Paddle notifications; verifies `Paddle-Signature`; upserts `vessel_subscriptions`.

Deploy (from `yachy-app` with Supabase CLI linked):

```bash
supabase functions deploy create-paddle-checkout
supabase functions deploy paddle-webhook --no-verify-jwt
```

`create-paddle-checkout` expects a logged-in user JWT (default Edge verify). `paddle-webhook` is called by Paddle only — use `--no-verify-jwt` so the gateway does not require a Supabase JWT.

### Secrets (Supabase Dashboard → Edge Functions → Secrets)

| Name                    | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `PADDLE_API_KEY`        | Server API key from Paddle (sandbox or live)     |
| `PADDLE_WEBHOOK_SECRET` | Signing secret for your webhook destination      |
| `PADDLE_ENV`            | `sandbox` (default) or `live` — selects API host |

### Paddle Dashboard

1. **Checkout:** Set a **default payment link** (Checkout settings) so new transactions get a `checkout.url`.
2. **Notifications:** Add destination URL  
   `https://<project-ref>.supabase.co/functions/v1/paddle-webhook`  
   and subscribe to subscription and transaction events (e.g. `transaction.completed`, `subscription.created`, `subscription.updated`, `subscription.canceled`, `subscription.past_due`).
3. **Return URL:** Configure success/cancel redirects for your app scheme (e.g. `nauticalops://`) if required by your checkout theme.

### Price IDs

Mapped in [`src/constants/subscriptionPlans.ts`](src/constants/subscriptionPlans.ts) (`PADDLE_PRICE_IDS`) and duplicated in the Edge Function for server-side resolution.

### Database

Run migration [`supabase/migrations/20260322120000_vessel_subscriptions_paddle.sql`](supabase/migrations/20260322120000_vessel_subscriptions_paddle.sql) (adds `paddle_*`, removes `stripe_*`).

## RevenueCat (App Store)

Offerings/packages must match plan tier and billing period identifiers used in [`src/services/subscription.ts`](src/services/subscription.ts). Entitlement id: `vessel_subscription`.

## Testing

- Use **Paddle Sandbox** first (`PADDLE_ENV=sandbox`).
- After checkout, confirm `vessel_subscriptions` updates via webhook (check Supabase logs and Paddle notification delivery).
