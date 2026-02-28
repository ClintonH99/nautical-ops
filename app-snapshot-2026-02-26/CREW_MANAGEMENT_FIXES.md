# Crew Management Fixes - February 16, 2026

## 🐛 Issues Fixed

### Issue 1: Crew Members Not Showing in Crew Management
**Problem:** HODs could not see crew members in the Crew Management screen.

**Root Cause:** Row Level Security (RLS) policy on the `users` table only allowed users to view their own profile. This prevented HODs from viewing other crew members in their vessel.

**Solution:** Added a new RLS policy that allows users to view other users in the same vessel.

---

### Issue 2: No Prominent Invite Code Button
**Problem:** No easy way for HODs to quickly share invite codes with new crew members from the Crew Management screen.

**Solution:** Added a prominent invite code card at the top of the Crew Management screen with:
- Large, visible invite code display
- Quick copy button
- Quick share button
- Link to full invite management

---

## 🔧 How to Fix

### Step 1: Run the Database Fix

You **MUST** run this SQL command in Supabase SQL Editor:

```sql
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
```

**Or use the provided file:**
1. Open Supabase Dashboard
2. Go to SQL Editor
3. Open the file `FIX_CREW_VISIBILITY.sql`
4. Click "Run"

**This is CRITICAL** - Without this policy, crew members will not show up in the Crew Management screen!

---

### Step 2: Restart Your App

After running the SQL, restart your Expo app:
```bash
cd "/Users/clintonhandford/Desktop/Yachy App/yachy-app"
npm start
```

---

## ✅ What's Changed

### Database Changes:
- **New RLS Policy:** `"Users can view crew in their vessel"` - Allows authenticated users to view other users in the same vessel

### Code Changes:
- **Updated `CrewManagementScreen.tsx`:**
  - Added vessel state to store vessel information
  - Added `loadData()` function to load both crew and vessel data
  - Added `handleCopyInviteCode()` function
  - Added `handleShareInviteCode()` function
  - Added `handleViewInviteCode()` function (shows full details)
  - Added prominent invite card at top of screen
  - Card shows: vessel name, invite code, copy button, share button
  - Added styles for invite card

### Visual Changes:
The Crew Management screen now has:
1. **Invite Code Card (Top)** - Navy blue card with:
   - "Invite New Crew" title
   - Large invite code display
   - "Copy Code" button
   - "Share Code" button
   - "View full details" link
2. **Crew Statistics** - Total, HODs, Crew counts
3. **Crew List** - All crew members with avatars

---

## 🧪 Testing Instructions

### Test 1: Verify Database Fix
1. Log in as Captain/HOD
2. Go to Settings → Crew Management
3. You should now see yourself in the crew list
4. If you see "No Crew Members", the database fix hasn't been applied

### Test 2: Test with Multiple Users
1. **As Captain/HOD:**
   - Go to Crew Management
   - Copy the invite code (using the card at top)
   
2. **As New User (use different device or logout):**
   - Register as Crew
   - Use the invite code
   - Complete registration
   
3. **Back as Captain/HOD:**
   - Pull to refresh in Crew Management
   - New crew member should appear in the list

### Test 3: Test Invite Code Functions
1. Tap "Copy Code" - Should copy and show confirmation
2. Tap "Share Code" - Should open system share dialog
3. Tap "View full details" - Should show alert with code info
4. Verify invite code is displayed prominently at top

---

## 📊 Expected Results After Fix

### Crew Management Screen Should Show:
```
┌─────────────────────────────────────┐
│  Invite New Crew                    │
│  Share this code for crew to join   │
│                          ABCD1234    │ ← Large code
│  [📋 Copy Code]  [📤 Share Code]    │
│  View full details & manage code →  │
└─────────────────────────────────────┘

┌─────┬─────┬─────┐
│  2  │  1  │  1  │
│Total│HODs │Crew │
└─────┴─────┴─────┘

Crew Members
─────────────
👤 Captain Name (YOU)
   Captain • DECK
   [HOD]

👤 Crew Member Name
   Deckhand • DECK
   [CREW]
```

---

## 🔐 Security Note

The new RLS policy ensures:
- ✅ Users can only see crew members in THEIR vessel
- ✅ Users cannot see crew from other vessels
- ✅ Users must be authenticated to view crew
- ✅ Vessel_id must be non-null to view crew

The policy works by:
1. Checking if the user's vessel_id matches the crew member's vessel_id
2. Using a subquery to get the current user's vessel_id from auth.uid()
3. Only returning crew members with matching vessel_ids

---

## 🐛 Troubleshooting

### Problem: Still seeing "No Crew Members"
**Solutions:**
1. Verify the SQL policy was created:
   ```sql
   SELECT * FROM pg_policies 
   WHERE tablename = 'users' 
   AND policyname = 'Users can view crew in their vessel';
   ```
2. Check that your user has a vessel_id set
3. Try logging out and back in
4. Check Supabase logs for errors

### Problem: Invite code not showing
**Solutions:**
1. Verify your user is HOD
2. Verify vessel data is loading (check console logs)
3. Check that vessel has an invite_code in database

### Problem: Copy/Share not working
**Solutions:**
1. Verify `expo-clipboard` is installed: `npm list expo-clipboard`
2. If not installed: `npm install expo-clipboard`
3. Restart Expo development server

---

## 📝 Files Changed

1. **`FIX_CREW_VISIBILITY.sql`** (NEW) - Database fix SQL
2. **`src/screens/CrewManagementScreen.tsx`** (UPDATED) - Added invite card and functions
3. **`CREW_MANAGEMENT_FIXES.md`** (NEW) - This documentation

---

## 🚀 Next Steps

After verifying these fixes work:

1. ✅ Test with multiple crew members
2. ✅ Test promote/demote functions
3. ✅ Test remove crew function
4. ✅ Test invite code sharing with real devices
5. ✅ Continue building next features (Tasks, Inventory, etc.)

---

## 📞 Quick Reference

**To view crew:** Settings → Crew Management

**To share invite code:** 
- Crew Management → Tap "Share Code" button at top

**To copy invite code:** 
- Crew Management → Tap "Copy Code" button at top

**To manage vessel settings:**
- Settings → Vessel Settings

---

**Status:** ✅ FIXED - Ready for testing  
**Date:** February 16, 2026  
**Critical:** Must run SQL fix before crew will show!
