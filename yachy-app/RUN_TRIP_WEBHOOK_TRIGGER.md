# Deprecated Trip Trigger Instructions

Do not use the old SQL trigger. It required a privileged key to be stored as
plain text in a database function and is intentionally disabled in the repo.

The production project already has a Dashboard Database Webhook named
`Trip created → push` for `trips` inserts.

## Steps

1. Supabase Dashboard → **Integrations** → **Database Webhooks** → **Webhooks**.
2. Edit `Trip created → push`.
3. Confirm it targets the `send-trip-push` Edge Function using POST.
4. Confirm **Add auth header with service key** is configured.
5. Create a trip in the app and confirm that the push arrives.
