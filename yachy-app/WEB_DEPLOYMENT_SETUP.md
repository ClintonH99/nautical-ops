# Web Deployment Setup (nautical-ops.com)

For [https://www.nautical-ops.com](https://www.nautical-ops.com) to work correctly with sign-in, configure Supabase as follows.

## 1. Add Your Web URL to Supabase

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) → select your project
2. **Authentication** → **URL Configuration**
3. Set **Site URL** to: `https://www.nautical-ops.com`
4. Under **Redirect URLs**, add:
   - `https://www.nautical-ops.com`
   - `https://www.nautical-ops.com/**` (optional, for OAuth callback paths)
   - `http://localhost:8081` (for local dev)

Without this, web sign-in can hang or fail.

## 2. Allow Multiple Devices (Unlimited Sessions)

By default Supabase allows unlimited active sessions per user (phone, laptop, tablet, etc.).

**If you have a Pro plan**, check that "Single session per user" is **disabled**:

1. **Authentication** → **Sessions** (or Settings)
2. Ensure **"Single session per user"** is **OFF**

When this is ON, signing in on a new device logs out the previous one. With it OFF, the same captain can use both phone and laptop at the same time.

## 3. Verify Users Table RLS

Ensure captains can read their profile (including `vessel_id`):

```sql
-- If needed, ensure users can read own profile
CREATE POLICY "Users can read own profile"
ON public.users FOR SELECT
USING (auth.uid() = id);
```

Run in **SQL Editor** if the policy does not already exist.

## 4. Enable Realtime for App ↔ Web Sync

For the app and website to stay in sync when data changes on either platform, enable Postgres Realtime on the `users` and `vessels` tables:

1. Go to **Database** → **Replication** (or **Publications**)
2. Under `supabase_realtime`, add the `users` and `vessels` tables

Or run in **SQL Editor**:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
ALTER PUBLICATION supabase_realtime ADD TABLE public.vessels;
```

If a table is already in the publication, you may see an error—that's fine.
