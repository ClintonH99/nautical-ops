# Trip Push Notifications Setup

This guide sets up push notifications for trips:
1. **Immediate** – As soon as a trip is created (urgent)
2. **Day before** – Reminder the day before the trip starts

## Prerequisites

- `push_token` and `notification_preferences` columns on `users` (run `ADD_USERS_PUSH_TOKEN.sql` and `ADD_USER_NOTIFICATION_PREFERENCES.sql` if not done)
- Supabase project linked (`supabase link`)
- Expo Access Token (optional, for enhanced security – [create one](https://expo.dev/accounts/_/settings/access-tokens))

---

## Step 1: Deploy the Edge Function

Install Supabase CLI (if needed) and log in:

```bash
cd yachy-app
npx supabase login
```

Then deploy:

```bash
npx supabase functions deploy send-trip-push
```

(Or install globally: `npm install -g supabase`, then use `supabase` instead of `npx supabase`.)

Set the Expo Access Token (optional but recommended):

```bash
supabase secrets set EXPO_ACCESS_TOKEN=your-expo-access-token
```

---

## Step 2: Database Webhook (Immediate – New Trip)

When a trip is **created**, notify all vessel crew with push enabled and trips preference on.

1. Go to **Supabase Dashboard** → your project → **Database** → **Webhooks** (or **Integrations** → **Webhooks**)
2. Click **Create webhook**
3. Configure:
   - **Name**: `Trip created → push`
   - **Table**: `trips`
   - **Events**: **Insert** only
   - **Type**: Supabase Edge Function
   - **Function**: `send-trip-push`
   - **HTTP method**: POST
4. Save

---

## Step 3: Day-Before Reminders (Cron)

The Edge Function must be called daily with a POST request whose body is `{ "type": "reminders" }`. This is **not** a terminal command – it’s the JSON payload your cron job sends to the function URL.

### Option A: Vercel Cron (recommended)

1. Create `api/cron/trip-reminders.ts`:

```ts
export const config = { maxDuration: 30 };
export default async function handler(req: Request) {
  if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('Unauthorized', { status: 401 });
  const url = `${process.env.SUPABASE_URL}/functions/v1/send-trip-push`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ type: 'reminders' }),
  });
  return new Response(JSON.stringify(await res.json()), { status: res.status });
}
```

2. Add to `vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/trip-reminders", "schedule": "0 8 * * *" }]
}
```

Runs daily at 8:00 UTC. Adjust `schedule` as needed.

### Option B: GitHub Actions

Create `.github/workflows/trip-reminders.yml`:

```yaml
name: Trip reminders
on:
  schedule:
    - cron: '0 8 * * *'  # 8:00 UTC daily
jobs:
  send:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST "${{ secrets.SUPABASE_URL }}/functions/v1/send-trip-push" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            -d '{"type":"reminders"}'
```

Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as GitHub repo secrets.

---

## Summary

| Trigger            | How                          | Result                          |
|--------------------|------------------------------|---------------------------------|
| Trip **created**   | Database Webhook → Edge Fn   | Immediate push to vessel crew  |
| **Day before**     | Cron → Edge Fn               | Reminder for trips tomorrow    |

Both flows respect `notification_preferences.trips` – only users who opted in receive notifications.

---

## Troubleshooting: No notification received

### Checklist

1. **Push enabled in app?**  
   Settings → Notifications → Push notifications **ON**  
   Trips (and optionally Pre-Departure) toggles **ON**

2. **Database Webhook created?**  
   Without it, no push is sent when a trip is created.  
   Supabase Dashboard → **Database** → **Webhooks** → create webhook on `trips` table, Insert only → Edge Function `send-trip-push`.

3. **Cron set up for day-before?**  
   Without it, no reminder the day before. Add the GitHub workflow below or use Vercel Cron.

4. **Trip date correct?**  
   Day-before reminder only sends for trips starting **tomorrow**.  
   Example: for a reminder on Feb 23, the trip `start_date` must be Feb 24.

5. **Using a physical device?**  
   Push does not work on simulators.

### Test immediately (new trip)

Create a trip in the app. If the Database Webhook is set up, a push should arrive within a few seconds.

### Test day-before reminder (manual)

Run in terminal (replace with your project URL and service role key from Supabase Dashboard → Settings → API):

```bash
curl -X POST "https://grtrcjgsvfsknpnlarxv.supabase.co/functions/v1/send-trip-push" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -d '{"type":"reminders"}'
```

This triggers the day-before logic. Create a trip with `start_date` = tomorrow, then run the curl. You should get a push if your user has a `push_token` and trips/preDeparture enabled.
