-- =============================================
-- CREW VISIBILITY FIX - VERIFIED VERSION
-- =============================================
-- This fixes the issue where HODs cannot see crew members
-- Run this in Supabase SQL Editor
-- Date: February 16, 2026

-- =============================================
-- STEP 1: Check Current Policies
-- =============================================

-- See what policies currently exist on users table
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'users' 
AND schemaname = 'public'
ORDER BY policyname;

-- =============================================
-- STEP 2: Drop Existing Vessel Crew Policy (if exists)
-- =============================================

DROP POLICY IF EXISTS "Users can view crew in their vessel" ON public.users;

-- =============================================
-- STEP 3: Create New Policy for Viewing Vessel Crew
-- =============================================

-- This policy allows authenticated users to view OTHER users 
-- who are in the SAME vessel
CREATE POLICY "Users can view crew in their vessel"
ON public.users
FOR SELECT
TO authenticated
USING (
  -- Allow viewing users who have the same vessel_id as the current user
  vessel_id IS NOT NULL 
  AND vessel_id = (
    SELECT vessel_id 
    FROM public.users 
    WHERE id = auth.uid()
  )
);

-- =============================================
-- STEP 4: Verify Policy Was Created
-- =============================================

-- This should return the new policy
SELECT 
  policyname,
  cmd,
  qual::text as using_clause
FROM pg_policies 
WHERE tablename = 'users' 
AND policyname = 'Users can view crew in their vessel';

-- =============================================
-- STEP 5: Test Query (Manual Verification)
-- =============================================

-- Replace 'YOUR_VESSEL_ID' with your actual vessel ID
-- This query should return all crew in that vessel
-- SELECT 
--   id,
--   name,
--   email,
--   position,
--   department,
--   role,
--   vessel_id
-- FROM public.users
-- WHERE vessel_id = 'YOUR_VESSEL_ID'
-- ORDER BY created_at;

-- =============================================
-- STEP 6: Verify RLS is Enabled
-- =============================================

-- Check if RLS is enabled on users table
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables 
WHERE tablename = 'users' 
AND schemaname = 'public';

-- Should return: rowsecurity = true

-- =============================================
-- Expected Result After Running This:
-- =============================================

/*
You should have these SELECT policies on users table:

1. "Users can view own profile"
   - Allows viewing your own user record
   
2. "Users can view crew in their vessel" (NEW!)
   - Allows viewing other users in the same vessel
   
3. "Service role bypass"
   - Service role can view everything

With these policies, HODs should see:
- Themselves in the crew list
- All crew members in their vessel
- NOT crew from other vessels
*/

-- =============================================
-- Troubleshooting Queries
-- =============================================

-- Check if users have vessel_id set
-- SELECT id, email, name, vessel_id, role 
-- FROM public.users 
-- ORDER BY created_at DESC 
-- LIMIT 10;

-- Check vessels and their invite codes
-- SELECT id, name, invite_code, invite_expiry 
-- FROM public.vessels 
-- ORDER BY created_at DESC;

-- =============================================
-- If Policy Still Not Working - Alternative Fix
-- =============================================

-- If the above doesn't work, you can temporarily disable RLS
-- WARNING: Only use for testing, not production!

-- ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;

-- To re-enable:
-- ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
