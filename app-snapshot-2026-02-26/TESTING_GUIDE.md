# Testing Guide - New Registration Flow

## Prerequisites

Before testing, ensure you've run the required SQL scripts in Supabase:
1. Make `vessel_id` nullable: `ALTER TABLE users ALTER COLUMN vessel_id DROP NOT NULL;`
2. Update RLS policies (see `DATABASE_CHANGES_REQUIRED.md`)

---

## Test Scenario 1: Register Without Invite Code

**Purpose:** Verify users can create accounts without being part of a vessel

### Steps:
1. Open the app
2. On Login screen, tap "Register"
3. Fill in all required fields:
   - Full Name
   - Email (use a new email)
   - Password
   - Confirm Password
   - Position
   - Department
4. **Note:** No invite code field should be visible
5. Tap "Create Account"

### Expected Results:
- ✅ Account created successfully
- ✅ Message shows "Account created successfully!"
- ✅ User is logged in
- ✅ Home screen shows "You're not part of a vessel yet" card
- ✅ Two buttons visible: "Join Vessel" and "Create Vessel"

### If Failed:
- Check console for errors
- Verify SQL scripts were run
- Check Supabase logs

---

## Test Scenario 2: Join Vessel After Registration

**Purpose:** Verify users can join vessels using invite codes after creating account

### Prerequisites:
- You need a valid invite code from an existing vessel
- OR create a vessel first (see Scenario 4)

### Steps:
1. Log in with account from Scenario 1
2. On Home screen, tap "Join Vessel"
3. You should see Join Vessel screen with:
   - Anchor icon (⚓)
   - "Join a Vessel" title
   - Info card explaining invite codes
   - Input field for invite code
4. Enter a valid invite code (8 characters, e.g., "ABC12345")
5. Tap "Join Vessel"

### Expected Results:
- ✅ Success alert: "You have successfully joined the vessel"
- ✅ Returns to Home screen
- ✅ Home screen now shows normal content (stats, features list)
- ✅ "No vessel" card is gone

### If Failed:
- "Invalid invite code" → Check invite code is correct
- "Invite code has expired" → Regenerate invite code (need Settings feature)
- "Failed to join vessel" → Check Supabase RLS policies
- Console error → Check auth service `joinVessel` method

---

## Test Scenario 3: Invalid Invite Code Handling

**Purpose:** Verify error handling for invalid codes

### Steps:
1. Log in with account that doesn't have a vessel
2. Tap "Join Vessel"
3. Try these invalid codes:
   - Empty field → tap "Join Vessel"
   - Invalid code: "INVALID1"
   - Too short: "ABC"
   - Too long: "ABCDEFGHI"

### Expected Results:
- ✅ Error message for empty field
- ✅ Error alert for invalid code
- ✅ User stays on Join Vessel screen
- ✅ Can try again with different code

---

## Test Scenario 4: Create Vessel (Existing Flow)

**Purpose:** Verify vessel creation still works

### Steps:
1. On Login screen, tap "Create New Vessel"
2. Enter vessel name (e.g., "My Yacht")
3. Tap "Create Vessel"
4. Note the invite code shown
5. Tap "Continue to Registration"
6. Fill in registration form
7. **Note:** Invite code field should be visible but disabled
8. Complete registration

### Expected Results:
- ✅ Vessel created successfully
- ✅ Invite code generated and shown
- ✅ Navigate to Register screen with invite code pre-filled
- ✅ User can complete registration
- ✅ User is assigned as HOD (Head of Department)
- ✅ User has immediate vessel access

---

## Test Scenario 5: Create Vessel After Registration

**Purpose:** Verify authenticated users can create vessels

### Steps:
1. Log in with account from Scenario 1 (no vessel)
2. On Home screen, tap "Create Vessel"
3. Enter vessel name
4. Tap "Create Vessel"

### Expected Results:
- ✅ Vessel created successfully
- ✅ Invite code generated and shown
- ✅ User can copy/share invite code
- ⚠️ **Current Issue:** User needs to manually update their profile to link to new vessel
- 🔧 **Fix Needed:** Auto-link user to vessel they create (future enhancement)

**Workaround:** After creating vessel, use the invite code on the "Join Vessel" screen

---

## Test Scenario 6: Navigation Flow

**Purpose:** Verify all navigation paths work

### Test 6A: From Login Screen
1. On Login, tap "Register" → Should show Register screen
2. Back, tap "Create New Vessel" → Should show Create Vessel screen
3. On Create Vessel, tap "Continue to Registration" → Should show Register with vesselId

### Test 6B: From Home Screen (No Vessel)
1. Log in without vessel
2. Tap "Join Vessel" → Should show Join Vessel screen
3. Tap "Back to Home" → Should return to Home
4. Tap "Create Vessel" → Should show Create Vessel screen

### Test 6C: From Join Vessel Screen
1. Navigate to Join Vessel
2. Tap "Create Your Own Vessel" → Should show Create Vessel screen
3. Tap back → Should return to Join Vessel

---

## Test Scenario 7: Login After Registration

**Purpose:** Verify persistence across sessions

### Steps:
1. Register new account (with or without vessel)
2. Log out
3. Log in with same credentials

### Expected Results:
- ✅ Login successful
- ✅ Home screen shows correct state (with/without vessel)
- ✅ If user had joined vessel, still shows vessel content
- ✅ If user had no vessel, still shows "no vessel" card

---

## Known Issues / Future Enhancements

1. **Creating vessel while logged in** doesn't auto-link user to vessel
   - Workaround: Use "Join Vessel" with the invite code
   - Fix: Update CreateVessel to auto-update user's vessel_id

2. **No way to leave a vessel** (future Settings feature)

3. **Can't see which vessel you're part of** (future feature)

4. **No vessel name on home screen** (future enhancement)

---

## Troubleshooting

### "null value in column vessel_id violates not-null constraint"
- Run: `ALTER TABLE users ALTER COLUMN vessel_id DROP NOT NULL;`

### Can't create vessels
- Run vessel RLS policy SQL from `DATABASE_CHANGES_REQUIRED.md`

### Can't join vessels  
- Verify user update RLS policy exists
- Check invite code is valid and not expired

### App crashes on login
- Check console for errors
- Verify all type definitions are correct (vesselId should be optional)

---

## Success Criteria

All tests pass when:
- ✅ Users can register without invite codes
- ✅ Users can log in and see "no vessel" state
- ✅ Users can join vessels with valid invite codes
- ✅ Error handling works for invalid codes
- ✅ Vessel creation flow still works
- ✅ Navigation works in all directions
- ✅ State persists across login/logout

---

## Quick Test Checklist

Use this for rapid testing:

- [ ] Register without invite code
- [ ] Login shows "no vessel" card
- [ ] Can navigate to Join Vessel
- [ ] Can join vessel with valid code
- [ ] Home shows normal content after joining
- [ ] Create vessel flow works
- [ ] Vessel creator gets HOD role
- [ ] Invalid codes show errors
- [ ] All navigation buttons work
- [ ] State persists after logout/login
