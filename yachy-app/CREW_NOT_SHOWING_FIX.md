# 🚨 CREW NOT SHOWING - COMPLETE FIX GUIDE

**Problem:** New crew member registered successfully but doesn't appear in HOD's Crew Management screen.

**Status:** This is a Row Level Security (RLS) issue that must be fixed in the database.

---

## 🔧 SOLUTION - Follow These Steps Exactly

### Step 1: Open Supabase Dashboard
1. Go to https://supabase.com
2. Open your project
3. Click "SQL Editor" in the left sidebar

### Step 2: Run the Database Fix

**Copy and paste this EXACT SQL:**

```sql
-- Drop any existing policy (in case it was created incorrectly)
DROP POLICY IF EXISTS "Users can view crew in their vessel" ON public.users;

-- Create the correct policy
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

**Click "Run" button (or press Cmd/Ctrl + Enter)**

You should see: "Success. No rows returned"

### Step 3: Verify the Policy Was Created

Run this query to check:

```sql
SELECT 
  policyname,
  cmd,
  qual::text as using_clause
FROM pg_policies 
WHERE tablename = 'users' 
AND policyname = 'Users can view crew in their vessel';
```

**Expected Result:** Should return 1 row showing the policy

### Step 4: Restart Your App

```bash
# Stop the Expo server (Ctrl+C)
# Then restart:
cd ~/Desktop/nautical-ops/yachy-app
npm start
```

### Step 5: Test in App

1. **Login as HOD**
2. Go to **Settings → Crew Management**
3. **Pull down to refresh**
4. You should now see ALL crew members

---

## 🔍 DEBUGGING - Check Console Logs

After adding the debugging, check your Expo console for these logs:

### What You Should See:

```
🔍 getVesselCrew - Fetching crew for vessel: abc-123-vessel-id
✅ getVesselCrew - Raw data received: 2 users
✅ getVesselCrew - Returning 2 crew members
```

### What Indicates a Problem:

```
🔍 getVesselCrew - Fetching crew for vessel: abc-123-vessel-id
✅ getVesselCrew - Raw data received: 0 users
⚠️ getVesselCrew - No crew members found for vessel: abc-123-vessel-id
💡 This could mean:
   1. No crew has joined this vessel yet
   2. RLS policy is blocking the query ← THIS IS THE ISSUE!
   3. vessel_id mismatch in database
```

If you see "0 users" returned, the RLS policy is definitely the issue.

---

## 🧪 VERIFY DATABASE STATE

Run these queries in Supabase SQL Editor to check everything:

### Check 1: Verify Crew Was Created

```sql
-- This shows ALL users (bypasses RLS)
-- Should show both HOD and crew member
SELECT 
  id,
  email,
  name,
  position,
  department,
  role,
  vessel_id,
  created_at
FROM public.users
ORDER BY created_at DESC
LIMIT 10;
```

**What to look for:**
- Both HOD and crew member should be listed
- Both should have the SAME `vessel_id`
- Crew member should have `role = 'CREW'`

### Check 2: Verify Vessel Exists

```sql
-- This shows your vessels
SELECT 
  id,
  name,
  invite_code,
  invite_expiry
FROM public.vessels
ORDER BY created_at DESC;
```

### Check 3: Test the RLS Policy

```sql
-- This tests what the authenticated user can see
-- Run this while logged into the app as HOD
SELECT 
  id,
  name,
  role,
  vessel_id
FROM public.users
WHERE vessel_id = 'YOUR_VESSEL_ID_HERE';
-- Replace YOUR_VESSEL_ID_HERE with the actual vessel_id from Check 1
```

**Expected:** Should return all users in that vessel  
**Problem:** If it returns 0 or 1 rows, RLS is blocking the query

---

## ⚠️ TEMPORARY WORKAROUND (For Testing Only!)

If you need to test immediately and the policy isn't working, you can temporarily disable RLS:

```sql
-- DISABLE RLS (temporarily)
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
```

**⚠️ WARNING:** This allows ALL users to see ALL other users. Only use for testing!

**To re-enable:**
```sql
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
```

---

## 📊 EXPECTED BEHAVIOR AFTER FIX

### Before Fix:
```
Crew Management Screen:
- Total: 1
- HODs: 1
- Crew: 0

Crew Members:
👤 Captain Name (YOU)
```

### After Fix:
```
Crew Management Screen:
- Total: 2
- HODs: 1
- Crew: 1

Crew Members:
👤 Captain Name (YOU)
   Captain • DECK [HOD]

👤 Crew Member Name
   Deckhand • DECK [CREW]
```

---

## 🔍 ROOT CAUSE EXPLANATION

**Why This Happens:**

1. Supabase uses Row Level Security (RLS) to protect data
2. By default, the policy only lets users see their OWN row
3. HODs need to see OTHER users in their vessel
4. Without the special policy, the query returns 0 rows (blocked by RLS)

**The Policy Fix:**

The SQL creates a policy that says:
"Let users see OTHER users who have the same vessel_id"

This is secure because:
- ✅ Users can only see crew in THEIR vessel
- ✅ Users cannot see crew from OTHER vessels
- ✅ Users must be authenticated (logged in)

---

## 📝 CHECKLIST

Use this checklist to verify the fix:

- [ ] Ran the DROP POLICY SQL
- [ ] Ran the CREATE POLICY SQL
- [ ] Verified policy exists (ran SELECT query)
- [ ] Restarted Expo app
- [ ] Logged in as HOD
- [ ] Went to Crew Management
- [ ] Pulled down to refresh
- [ ] Can see all crew members now? ✅

---

## 🆘 STILL NOT WORKING?

If crew still don't show after following all steps:

### Check Console Logs

Look in your Expo terminal for the debug logs:
```
🔍 getVesselCrew - Fetching crew for vessel: ...
✅ getVesselCrew - Raw data received: X users
```

### What the logs tell you:

| Log Message | Meaning | Action |
|------------|---------|---------|
| "0 users" | RLS is blocking | Re-run the SQL fix |
| "2+ users" | Data is loading | Check if crew state is updating |
| Error message | Database error | Check Supabase logs |

### Get More Info:

Share these with me:
1. Console logs from Expo terminal
2. Result of Check 1 query (user list)
3. Result of Check 3 query (RLS test)

---

## 📂 Files

- `FIX_CREW_VISIBILITY_VERIFIED.sql` - Complete fix with verification
- `src/services/user.ts` - Updated with debug logs

---

**Status:** 🔧 Awaiting Database Fix  
**Next Step:** Run the SQL in Supabase SQL Editor  
**Priority:** 🚨 CRITICAL - App won't work without this!
