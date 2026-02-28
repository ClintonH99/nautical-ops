# Trip Insert Push Trigger (Alternative to Dashboard Webhook)

If you prefer to set up the webhook via SQL instead of the Dashboard, run this migration.

**If you already created the webhook in the Dashboard:** Do NOT run this – you’d get duplicate notifications.

## Steps

1. **Enable pg_net** (if not already):
   - Supabase Dashboard → **Database** → **Extensions**
   - Search for `pg_net` → Enable

2. **Get your anon key**:
   - Dashboard → **Settings** → **API** → copy **anon public** key

3. **Run the migration**:
   - Dashboard → **SQL Editor** → New query
   - Open `supabase/migrations/ADD_TRIP_INSERT_WEBHOOK_TRIGGER.sql`
   - Replace `YOUR_ANON_KEY` with your anon key (the whole string between the quotes)
   - Run the query

4. **Test**: Create a new trip in the app. You should get a push notification within a few seconds.
