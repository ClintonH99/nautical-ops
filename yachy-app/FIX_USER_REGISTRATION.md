# 🚨 FIXING: "User Already Registered" & Crew Not Assigned

## The Problems

1. ❌ **"AuthApiError: User already registered"** - You tried to register with an email that's already in the database
2. ❌ **Crew not assigned to vessel** - Need to verify invite code validation is working

---

## 🔧 SOLUTION - Follow These Steps

### Step 1: Clean Up Test Users in Database

The "User already registered" error happens because Supabase stores the email even if registration failed partway through.

**Open Supabase SQL Editor and run:**

```sql
-- See all registered emails
SELECT 
  id,
  email,
  created_at
FROM auth.users
ORDER BY created_at DESC;

-- Delete the test user (replace with YOUR test email)
DELETE FROM auth.users WHERE email = 'your-test-email@example.com';
```

**Replace `'your-test-email@example.com'` with the actual email you tried to use!**

### Step 2: Apply the RLS Policy Fix

This allows HODs to see crew members:

```sql
-- Drop existing policy
DROP POLICY IF EXISTS "Users can view crew in their vessel" ON public.users;

-- Create correct policy
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
```

### Step 3: Restart Your App

```bash
# Stop Expo (Ctrl+C)
# Then restart:
cd "/Users/clintonhandford/Desktop/Yachy App/yachy-app"
npm start
```

### Step 4: Try Registration Again

Now try to register the crew member again with:
- ✅ A **DIFFERENT email** (not the one that failed)
- ✅ The **correct invite code** from your HOD

---

## 📋 Watch the Console Logs

I've added detailed logging so you can see exactly what's happening. When you register a crew member, look for these logs in your terminal:

### ✅ SUCCESSFUL Registration Looks Like:

```
🚀 Starting signup process...
📧 Email: crew@example.com
👤 Name: John Doe
🎫 Invite Code: ABCD1234
🔍 Validating invite code in database: ABCD1234
✅ Vessel found: My Yacht (ID: abc-123...)
📅 Expiry date: 2027-02-16...
📅 Current date: 2026-02-16...
✅ Invite code is valid and not expired
✅ Invite code valid! Vessel found: My Yacht (ID: abc-123...)
💾 Creating user profile with vessel_id: abc-123...
✅ Auth user created: xyz-789...
👔 Assigned role: CREW
✅ User profile created successfully!
🎉 Signup complete! User: John Doe Vessel ID: abc-123...
```

### ❌ FAILED Registration Looks Like:

```
🚀 Starting signup process...
📧 Email: test@example.com
❌ Auth signup error: User already registered
```

OR:

```
🚀 Starting signup process...
🔍 Validating invite code in database: WRONG123
❌ Database error when validating invite code: ...
❌ Invite code validation failed: Invalid invite code
```

---

## 🧪 Testing Checklist

### Test 1: Register New Crew Member

1. **As HOD:** Go to Crew Management → Copy invite code
2. **Use a FRESH email** (one you haven't used before!)
3. **Register as crew** with:
   - New email ✅
   - Valid invite code ✅
4. **Watch console logs** - should see "✅ Invite code valid!"
5. **Should auto-login** and see Home screen with vessel name

### Test 2: Verify Crew Shows in Management

1. **As HOD:** Go to Crew Management
2. **Pull down to refresh**
3. **Should see new crew member** in the list
4. **Check console logs** - should see "✅ getVesselCrew - Raw data received: 2 users"

---

## 📊 Verify in Database

Run these queries in Supabase to verify everything worked:

```sql
-- Check all users and their vessel assignments
SELECT 
  u.email,
  u.name,
  u.role,
  u.vessel_id,
  v.name as vessel_name
FROM public.users u
LEFT JOIN public.vessels v ON u.vessel_id = v.id
ORDER BY u.created_at DESC;
```

**What you should see:**
- HOD with vessel_id = (some id)
- Crew member with vessel_id = (SAME id as HOD)
- Vessel name should be filled in for both

**If crew member has vessel_id = NULL, the invite code didn't work!**

---

## 🔍 Common Issues & Solutions

### Issue 1: "User already registered"

**Cause:** Email already exists from previous failed registration

**Solution:** Delete the user from database:
```sql
DELETE FROM auth.users WHERE email = 'the-email@example.com';
```

Then try again with either:
- The same email (now deleted) ✅
- OR a different email ✅

---

### Issue 2: Crew has vessel_id = NULL

**Cause:** Invite code validation failed or wasn't provided

**Check console logs for:**
- "❌ Invalid invite code"
- "❌ Invite code has expired"
- "❌ No vessel found"

**Solutions:**
1. **Verify invite code is correct** (case-sensitive!)
2. **Check if code is expired:**
   ```sql
   SELECT name, invite_code, invite_expiry 
   FROM vessels 
   WHERE invite_expiry < NOW();
   ```
3. **Regenerate invite code** if expired (Vessel Settings screen)
4. **Manual fix (if needed):**
   ```sql
   UPDATE public.users 
   SET vessel_id = 'YOUR_VESSEL_ID'
   WHERE email = 'crew@example.com';
   ```

---

### Issue 3: Crew shows in database but NOT in app

**Cause:** RLS policy not applied

**Solution:** Run Step 2 above (RLS policy fix) then restart app

---

## 🎯 Success Criteria

After following all steps, you should have:

✅ No more "User already registered" errors (using fresh emails)  
✅ Console shows "✅ Invite code valid!"  
✅ Console shows "💾 Creating user profile with vessel_id: [id]"  
✅ Crew member auto-logs in after registration  
✅ Crew member sees vessel name on Home screen  
✅ HOD sees crew member in Crew Management list  
✅ Database shows both users with same vessel_id  

---

## 📂 Files Created

- `CLEANUP_AND_FIX.sql` - Complete database cleanup and fix script
- `FIX_USER_REGISTRATION.md` - This guide
- Updated `src/services/auth.ts` - With detailed logging

---

## 🆘 Still Having Issues?

If it's still not working after following all steps:

1. **Copy the console logs** from your terminal
2. **Run this query** and send me the results:
   ```sql
   SELECT 
     u.email,
     u.name,
     u.role,
     u.vessel_id,
     v.name as vessel_name,
     v.invite_code
   FROM public.users u
   LEFT JOIN public.vessels v ON u.vessel_id = v.id
   ORDER BY u.created_at DESC;
   ```
3. **Tell me:**
   - What email you're trying to use
   - What invite code you're using
   - What you see in the console logs

---

## 🎉 Quick Start (TL;DR)

1. Delete test user: `DELETE FROM auth.users WHERE email = 'test@example.com';`
2. Apply RLS fix (see Step 2 above)
3. Restart app: `npm start`
4. Register crew with **NEW email** and **correct invite code**
5. Watch console for "✅ Invite code valid!" and "✅ User profile created!"
6. Check Crew Management - new crew should appear

---

**Priority:** 🚨 HIGH - Must fix for app to work  
**Time:** ~5 minutes  
**Status:** Awaiting database cleanup
