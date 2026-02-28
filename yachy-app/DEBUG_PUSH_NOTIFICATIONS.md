# Debug: Push notifications not arriving

The function runs successfully (200) but you're not getting pushes. Check these:

## 1. Function logs (after next deployment)

1. Deploy the updated function: `npx supabase functions deploy send-trip-push`
2. Create a trip in the app
3. Supabase Dashboard → Edge Functions → send-trip-push → **Logs**
4. Look for: `Trip insert: { vesselId, usersFound, messagesToSend }`
   - **usersFound: 0** → No users in that vessel have push_token + trips enabled
   - **messagesToSend: 0** → Users found but no valid push tokens
   - **messagesToSend: 1+** → Messages sent to Expo – check device/permissions

## 2. Verify your user in Supabase

Run in **SQL Editor** (replace `YOUR_EMAIL` with your login email):

```sql
SELECT id, email, vessel_id, push_token IS NOT NULL AS has_push_token, notification_preferences
FROM users
WHERE email = 'YOUR_EMAIL';
```

**Must be true:**
- `vessel_id` is not null (you’re in a vessel)
- `has_push_token` is true
- `notification_preferences` shows `"trips": true` (or the field is null/empty, which defaults to true)

## 3. Verify trip vessel matches

When you create a trip, it uses your vessel. Check a recent trip:

```sql
SELECT id, vessel_id, title, start_date FROM trips ORDER BY created_at DESC LIMIT 3;
```

The `vessel_id` must match your user’s `vessel_id`.

## 4. App-side checklist

- Push notifications enabled in the app (Settings → Notifications → ON)
- Trips preference ON under “What to receive”
- Using a physical device (no simulator)
- App was reopened after enabling notifications (so the token was saved)
