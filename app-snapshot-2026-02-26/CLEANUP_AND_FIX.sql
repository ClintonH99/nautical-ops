-- =============================================
-- CLEAN UP AND FIX DATABASE
-- =============================================
-- This script will help fix the "User already registered" error
-- and ensure crew are properly assigned to vessels
-- Date: February 16, 2026

-- =============================================
-- STEP 1: Check Current State
-- =============================================

-- See all users and their vessel assignments
SELECT 
  u.id,
  u.email,
  u.name,
  u.role,
  u.vessel_id,
  v.name as vessel_name,
  v.invite_code,
  u.created_at
FROM public.users u
LEFT JOIN public.vessels v ON u.vessel_id = v.id
ORDER BY u.created_at DESC;

-- See all auth users (this is where the "already registered" comes from)
SELECT 
  id,
  email,
  created_at
FROM auth.users
ORDER BY created_at DESC;

-- =============================================
-- STEP 2: Clean Up Test Users (if needed)
-- =============================================

-- ⚠️ CAUTION: This will delete users!
-- Only run this if you need to clean up test accounts

-- First, identify the email you want to delete
-- Replace 'test@example.com' with the actual email

-- Option A: Delete specific user by email
-- DELETE FROM auth.users WHERE email = 'test@example.com';
-- This will CASCADE delete from users table too

-- Option B: Delete all users except one (dangerous!)
-- DELETE FROM auth.users WHERE email != 'keep-this@email.com';

-- Option C: Start completely fresh (deletes EVERYTHING!)
-- DELETE FROM public.vessels;
-- DELETE FROM public.users;
-- DELETE FROM auth.users;

-- =============================================
-- STEP 3: Fix RLS Policy (for viewing crew)
-- =============================================

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Users can view crew in their vessel" ON public.users;

-- Create correct policy for viewing vessel crew
CREATE POLICY "Users can view crew in their vessel"
ON public.users
FOR SELECT
TO authenticated
USING (
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

SELECT 
  policyname,
  cmd,
  qual::text as using_clause
FROM pg_policies 
WHERE tablename = 'users' 
AND schemaname = 'public'
ORDER BY policyname;

-- =============================================
-- STEP 5: Test Vessel Assignment
-- =============================================

-- Check if vessels have valid invite codes
SELECT 
  id,
  name,
  invite_code,
  invite_expiry,
  CASE 
    WHEN invite_expiry < NOW() THEN 'EXPIRED ❌'
    ELSE 'VALID ✅'
  END as status
FROM public.vessels
ORDER BY created_at DESC;

-- =============================================
-- STEP 6: Manual Vessel Assignment (if needed)
-- =============================================

-- If a user was created but not assigned to a vessel,
-- you can manually assign them:

-- First, find the user ID and vessel ID from Step 1

-- Then update:
-- UPDATE public.users 
-- SET vessel_id = 'YOUR_VESSEL_ID_HERE',
--     updated_at = NOW()
-- WHERE id = 'USER_ID_HERE';

-- =============================================
-- EXPECTED RESULTS
-- =============================================

/*
After running this, you should have:

1. Clean database with no duplicate test users
2. RLS policy that allows viewing crew in same vessel
3. All crew members properly assigned to vessels via invite codes

To verify everything is working:
1. Register a new crew member with a fresh email
2. Check the console logs in Expo
3. You should see:
   - "✅ Invite code valid! Vessel found: [name]"
   - "💾 Creating user profile with vessel_id: [id]"
   - "✅ User profile created successfully!"
4. HOD should see the new crew in Crew Management
*/

-- =============================================
-- Quick Delete Commands (for testing)
-- =============================================

-- Delete a specific user by email (use carefully!)
-- DELETE FROM auth.users WHERE email = 'test@example.com';

-- Delete the most recent user (useful if you just created a test account)
-- DELETE FROM auth.users 
-- WHERE id = (
--   SELECT id FROM auth.users 
--   ORDER BY created_at DESC 
--   LIMIT 1
-- );
