# Database Changes Required for Registration Flow Update

## Critical: Run These SQL Commands in Supabase

### 1. Make vessel_id Nullable in Users Table

Users can now register without being part of a vessel, so `vessel_id` must allow NULL values.

```sql
-- Allow vessel_id to be null
ALTER TABLE users ALTER COLUMN vessel_id DROP NOT NULL;
```

### 2. Update Row Level Security (RLS) Policies

If you haven't already run these from the previous session, run them now:

```sql
-- Drop old policy if exists
DROP POLICY IF EXISTS "Users can read their vessel" ON vessels;

-- Allow anyone to create vessels
CREATE POLICY "Anyone can create vessels" ON vessels
  FOR INSERT WITH CHECK (true);

-- Allow users to read their vessel
CREATE POLICY "Users can read their vessel" ON vessels
  FOR SELECT USING (
    id IN (SELECT vessel_id FROM users WHERE id = auth.uid())
  );

-- Allow users to update their vessel
CREATE POLICY "Users can update their vessel" ON vessels
  FOR UPDATE USING (
    id IN (SELECT vessel_id FROM users WHERE id = auth.uid())
  );
```

### 3. Update Users Table RLS Policies (Optional but Recommended)

Ensure users can update their own vessel_id when joining a vessel:

```sql
-- Allow users to read their own profile
CREATE POLICY IF NOT EXISTS "Users can read own profile" ON users
  FOR SELECT USING (id = auth.uid());

-- Allow users to update their own profile (including vessel_id)
CREATE POLICY IF NOT EXISTS "Users can update own profile" ON users
  FOR UPDATE USING (id = auth.uid());
```

## Verification

After running the SQL commands, verify:

1. **Check vessel_id is nullable:**
```sql
SELECT column_name, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'users' AND column_name = 'vessel_id';
-- Should show: is_nullable = YES
```

2. **Test user creation without vessel:**
```sql
-- This should work now (insert a test user without vessel_id)
INSERT INTO users (id, email, name, position, department, role, created_at, updated_at)
VALUES (
  'test-user-id',
  'test@example.com',
  'Test User',
  'Test Position',
  'DECK',
  'CREW',
  NOW(),
  NOW()
);

-- Clean up test
DELETE FROM users WHERE id = 'test-user-id';
```

3. **Test vessel_id update:**
```sql
-- This should work (updating a user's vessel_id)
UPDATE users 
SET vessel_id = 'some-vessel-id'
WHERE id = 'some-user-id';
```

## How to Run in Supabase

1. Open your Supabase project dashboard
2. Navigate to: **SQL Editor** (left sidebar)
3. Click **New Query**
4. Copy and paste the SQL commands above
5. Click **Run** (or press Cmd/Ctrl + Enter)
6. Verify the output shows success

## Expected Schema After Changes

```sql
-- Users table structure
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  position TEXT NOT NULL,
  department TEXT NOT NULL,
  role TEXT NOT NULL,
  vessel_id UUID REFERENCES vessels(id),  -- NOW NULLABLE
  profile_photo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Troubleshooting

### Error: "null value in column vessel_id violates not-null constraint"
- Solution: Run the `ALTER TABLE` command to make vessel_id nullable

### Error: "new row violates row-level security policy"
- Solution: Check that RLS policies are set up correctly
- Verify the "Anyone can create vessels" policy exists
- Verify the "Users can update own profile" policy exists

### Users can't join vessels
- Verify the `joinVessel` function in the app calls `UPDATE users SET vessel_id = ...`
- Check that the vessel's invite code is valid and not expired
- Verify RLS policies allow users to update their own profile

## Notes

- **Backup first**: Consider backing up your database before making schema changes
- **Test thoroughly**: After making changes, test the full flow:
  1. Register without invite code
  2. Login
  3. Join vessel with invite code
  4. Verify user has access to vessel data
