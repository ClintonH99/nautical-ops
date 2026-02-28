-- CLEANUP DATABASE FOR TESTING
-- Run this in Supabase SQL Editor when you need to reset during development

-- ⚠️ WARNING: This will delete ALL data in these tables!
-- Only use during development/testing

-- 1. Delete all vessels
DELETE FROM vessels;

-- 2. Reset all users' vessel_id and role
UPDATE users 
SET vessel_id = NULL, 
    role = 'CREW',
    updated_at = NOW();

-- 3. Delete all users from public.users table
DELETE FROM users;

-- 4. Delete all auth users (IMPORTANT - removes orphaned auth sessions)
DELETE FROM auth.users;

-- ===================================================
-- COMPLETE FRESH START (Run all commands above)
-- ===================================================
-- After running the above:
-- 1. Reload your app
-- 2. Create a new Captain account (will be saved properly now)
-- 3. Create a vessel
-- 4. Test crew registration

-- ===================================================
-- Quick Commands Reference
-- ===================================================

-- View all vessels:
-- SELECT * FROM vessels;

-- View all users with their vessel:
-- SELECT id, email, name, role, vessel_id FROM users;

-- View all auth users:
-- SELECT id, email FROM auth.users;

-- Find orphaned auth users (auth users without profile):
-- SELECT au.id, au.email 
-- FROM auth.users au
-- LEFT JOIN users u ON au.id = u.id
-- WHERE u.id IS NULL;

-- Delete orphaned auth users:
-- DELETE FROM auth.users 
-- WHERE id NOT IN (SELECT id FROM users);

-- Count vessels:
-- SELECT COUNT(*) FROM vessels;

-- Count users:
-- SELECT COUNT(*) FROM users;

-- Delete a specific vessel by ID:
-- DELETE FROM vessels WHERE id = 'your-vessel-id-here';

-- Delete a specific user by email:
-- DELETE FROM users WHERE email = 'user@example.com';
-- DELETE FROM auth.users WHERE email = 'user@example.com';

-- ===================================================
-- IMPORTANT: After running cleanup
-- ===================================================
-- 1. Close and reopen your app (clears cached sessions)
-- 2. You'll need to create a new Captain account
-- 3. Then create a new vessel
-- 4. Captain will automatically be assigned to the vessel
-- 5. You can then test crew registration with the new invite code
