# Fixed: Vessel Creation & Registration Flow

**Date:** February 16, 2026  
**Status:** ✅ Fixed

---

## 🔧 What Was Fixed

### Problem 1: RLS Policy Blocking Vessel Creation
**Error:** "new row violates row-level security policy for table vessels"

**Solution:** Updated RLS policies to allow anyone to create vessels

### Problem 2: Invite Code Required for Registration
**Issue:** Couldn't register without an invite code, but vessel creators don't have one yet

**Solution:** Made invite code optional for vessel creators

---

## 📋 Steps to Fix Your Database

### Run This SQL in Supabase

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Click **"New query"**
3. Paste and run this SQL:

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

4. Click **"Run"**
5. You should see "Success. No rows returned"

---

## ✨ How It Works Now

### New User Flow (Vessel Creator)

1. **Create Vessel**
   - User taps "Create New Vessel"
   - Enters vessel name
   - Gets unique invite code
   - Vessel is created in database ✅

2. **Register Account**
   - Automatically navigates to registration
   - Invite code is pre-filled and locked
   - User completes registration
   - **Automatically assigned as "HOD" (Head of Department)** 👨‍✈️

3. **Post-Registration**
   - User is logged in
   - Linked to their vessel
   - Can share invite code with crew
   - Can manage vessel settings (coming soon)

### Existing Crew Flow

1. **Receive Invite Code**
   - Gets code from captain/owner

2. **Register with Code**
   - Taps "Register"
   - Enters invite code
   - Completes registration
   - **Assigned as "CREW"**

3. **Join Vessel**
   - User is logged in
   - Linked to vessel via invite code

---

## 🎯 Key Changes Made

### 1. Database Policies (Supabase)
- ✅ Anyone can create vessels
- ✅ Users can read their own vessel
- ✅ Users can update their vessel

### 2. Auth Service
- ✅ Added `vesselId` parameter to registration
- ✅ Automatically assigns "HOD" role to vessel creators
- ✅ Assigns "CREW" role to invite code users
- ✅ Invite code now optional when vesselId provided

### 3. Registration Screen
- ✅ Detects if user is vessel creator
- ✅ Shows different subtitle for creators
- ✅ Locks invite code field for creators
- ✅ Shows "Vessel Creator" badge
- ✅ Hides "Create Vessel" link for creators
- ✅ Makes invite code optional for creators

### 4. Create Vessel Screen
- ✅ Passes `vesselId` to registration
- ✅ User becomes first member of vessel

---

## 🧪 Test the Fixed Flow

### Test 1: Create New Vessel
1. Open app on your phone
2. Tap **"Create New Vessel"**
3. Enter: "Test Yacht"
4. Tap **"Create Vessel & Get Invite Code"**
5. ✅ Should work without RLS error

### Test 2: Register as Creator
1. After creating vessel, tap **"Continue to Registration"**
2. Fill in your details
3. Notice invite code is pre-filled and locked
4. See "Vessel Creator" badge
5. Complete registration
6. ✅ Should register successfully as HOD

### Test 3: Verify in Database
1. Go to Supabase Dashboard
2. Table Editor → `vessels`
3. See your vessel created
4. Table Editor → `users`
5. See your user with `role = 'HOD'` and linked `vessel_id`

---

## 🔐 Role Assignment

### HOD (Head of Department)
- **Who:** Vessel creators
- **When:** Automatically assigned during registration
- **Permissions:** Can manage vessel, change invite codes (coming soon)

### CREW
- **Who:** Users who join via invite code
- **When:** Assigned during registration with invite code
- **Permissions:** Standard crew access

---

## 🎨 UI Updates

### Registration Screen Changes

**For Vessel Creators:**
- Title: "Set up your captain account"
- Invite code field: Pre-filled and disabled
- Badge: "⚓ Vessel Creator - You'll be assigned as Head of Department"
- Success message: "Your vessel is ready! You are the Head of Department."

**For Regular Crew:**
- Title: "Join your vessel crew"
- Invite code field: Editable
- Link: "Create Vessel" (if no code)
- Success message: "Welcome aboard!"

---

## 🚀 What's Next

### Future Features (Settings Page)
- [ ] View/edit vessel name
- [ ] Regenerate invite code
- [ ] Set invite code expiry
- [ ] View crew members
- [ ] Revoke invite codes
- [ ] Manage HOD assignments

---

## 📝 Summary

### Before Fix ❌
- RLS policy blocked vessel creation
- Required invite code for all registrations
- Couldn't create vessel and register
- All users were "CREW"

### After Fix ✅
- Anyone can create vessels
- Invite code optional for creators
- Seamless vessel creation → registration flow
- Vessel creators are "HOD", others are "CREW"
- Clear UI distinction for creators

---

## ⚠️ Important

**You MUST run the SQL script above in Supabase** for the vessel creation to work!

The code changes are already made to your app, but the database policies need to be updated.

---

**Status:** ✅ Ready to test after running SQL script!
