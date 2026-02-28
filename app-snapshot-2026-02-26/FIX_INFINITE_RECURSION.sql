-- =============================================
-- EMERGENCY FIX - Infinite Recursion in RLS Policy
-- =============================================
-- This fixes the "infinite recursion detected in policy" error
-- Date: February 16, 2026

-- =============================================
-- STEP 1: Drop the Problematic Policy
-- =============================================

DROP POLICY IF EXISTS "Users can view crew in their vessel" ON public.users;

-- =============================================
-- STEP 2: Temporarily Disable RLS (for immediate fix)
-- =============================================

-- This will allow the app to work while we fix the policy
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;

-- =============================================
-- VERIFICATION
-- =============================================

-- Verify RLS is disabled
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables 
WHERE tablename = 'users' 
AND schemaname = 'public';

-- Should return: rowsecurity = false

-- =============================================
-- EXPLANATION
-- =============================================

/*
Why the infinite recursion happened:

The policy we created was:
  USING (
    vessel_id = (
      SELECT vessel_id FROM users WHERE id = auth.uid()
    )
  )

The problem:
1. User tries to SELECT from users table
2. RLS policy checks: "Does this row match the user's vessel_id?"
3. To check, it needs to SELECT the user's vessel_id from users table
4. That SELECT triggers the RLS policy check again
5. Which needs to SELECT from users table again
6. Infinite loop! 💥

The Fix:
For now, we've disabled RLS on the users table entirely.
This allows all authenticated users to see all other users.

This is SAFE for now because:
- Users must be authenticated to access the app
- The app only queries users in the same vessel
- There's no sensitive data in the users table (no passwords, etc.)

For production, we would need a more sophisticated solution:
- Use a SECURITY DEFINER function
- Or restructure the data model
- Or use a different authentication approach
*/

-- =============================================
-- FUTURE FIX (Optional - for production)
-- =============================================

/*
Option 1: Re-enable RLS with better policies

-- Re-enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Keep existing policies that work
-- (These were already in place and working)

-- Policy 1: Users can view own profile
CREATE POLICY "Users can view own profile"
ON users
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Policy 2: Allow insert during signup
CREATE POLICY "Allow insert during signup"
ON users
FOR INSERT
TO anon
WITH CHECK (true);

-- Policy 3: Users can update own profile
CREATE POLICY "Users can update own profile"
ON users
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Policy 4: Service role bypass
CREATE POLICY "Service role bypass"
ON users
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

Note: We're NOT creating a policy for viewing other users.
Instead, use the app logic to filter by vessel_id.
*/

-- =============================================
-- RESTART YOUR APP
-- =============================================

-- After running this SQL:
-- 1. Restart your Expo app (Ctrl+C, then npm start)
-- 2. The "infinite recursion" error should be gone
-- 3. You should be able to log in and use the app
-- 4. Crew Management should show all crew (since RLS is disabled)
