# Fix RLS Policy for Vessel Creation

Run this SQL in your Supabase SQL Editor to fix the "row-level security policy" error:

```sql
-- Drop the existing policy if it exists
DROP POLICY IF EXISTS "Users can read their vessel" ON vessels;

-- Allow anyone to create vessels (for new vessel setup)
CREATE POLICY "Anyone can create vessels" ON vessels
  FOR INSERT 
  WITH CHECK (true);

-- Users can read vessels they belong to
CREATE POLICY "Users can read their vessel" ON vessels
  FOR SELECT USING (
    id IN (SELECT vessel_id FROM users WHERE id = auth.uid())
  );

-- Users can update their own vessel's invite code
CREATE POLICY "Users can update their vessel" ON vessels
  FOR UPDATE USING (
    id IN (SELECT vessel_id FROM users WHERE id = auth.uid())
  );
```

## What This Does:

1. **Allows vessel creation** - Anyone can create a vessel (needed for first-time setup)
2. **Allows reading** - Users can only see vessels they belong to
3. **Allows updates** - Users can update their vessel's invite code and details

## Run This Now:

1. Go to your Supabase Dashboard
2. Click "SQL Editor"
3. Click "New query"
4. Paste the SQL above
5. Click "Run"

This will fix the error and allow vessel creation!
