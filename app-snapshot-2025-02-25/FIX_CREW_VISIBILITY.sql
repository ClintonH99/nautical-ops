-- =============================================
-- Fix Crew Management - Allow HODs to View All Crew
-- =============================================
-- Run this in Supabase SQL Editor
-- Date: February 16, 2026

-- =============================================
-- ISSUE: HODs cannot see other crew members
-- =============================================
-- Current policy only allows users to see their own profile
-- Need to allow users to see other crew members in their vessel

-- =============================================
-- SOLUTION: Add policy for viewing vessel crew
-- =============================================

-- Allow users to view other users in the same vessel
CREATE POLICY "Users can view crew in their vessel"
ON users
FOR SELECT
TO authenticated
USING (
  vessel_id IS NOT NULL 
  AND vessel_id IN (
    SELECT vessel_id 
    FROM users 
    WHERE id = auth.uid()
  )
);

-- =============================================
-- Verification
-- =============================================

-- Check all policies on users table
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies 
WHERE tablename = 'users' 
AND schemaname = 'public';

-- =============================================
-- Expected Policies After Running This:
-- =============================================
/*
1. "Enable insert for authenticated users" - INSERT for authenticated
2. "Users can view own profile" - SELECT for own profile
3. "Users can view crew in their vessel" - SELECT for vessel crew (NEW!)
4. "Users can update own profile" - UPDATE for own profile
5. "Service role bypass" - ALL for service_role
6. "Allow insert during signup" - INSERT for anon
*/

-- =============================================
-- Test Query (run as authenticated user)
-- =============================================

-- This should return all users in your vessel
-- SELECT * FROM users WHERE vessel_id = 'your-vessel-id';

-- =============================================
-- Cleanup (if needed)
-- =============================================

/*
-- To remove this policy:
DROP POLICY IF EXISTS "Users can view crew in their vessel" ON users;
*/
