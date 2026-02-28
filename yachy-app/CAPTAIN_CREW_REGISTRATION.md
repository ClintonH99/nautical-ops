# Captain vs Crew Registration Flow - Implementation Guide

## Overview

The app now has **two separate registration paths** based on user role:

1. **Captain** - Creates vessel, no invite code needed during registration
2. **Crew** - Joins vessel, invite code REQUIRED during registration

---

## What Changed

### Login Screen

**Before:**
- Single "Register" button
- "Create New Vessel" button

**After:**
- Two distinct registration options:
  - "Create Captain Account" (⚓)
  - "Create Crew Account" (👥)
- Each clearly labeled with icon and description

### Registration Screens

**Now 3 separate screens:**

1. **RegisterCaptainScreen**
   - No invite code field
   - Captain creates account first
   - Creates vessel after logging in
   - Gets HOD role after vessel creation

2. **RegisterCrewScreen**
   - Invite code field (REQUIRED)
   - Must have valid invite code to register
   - Automatically joins vessel during registration
   - Gets CREW role

3. **RegisterScreen** (legacy - kept for backward compatibility)
   - Can be removed if desired

---

## User Flows

### Flow 1: Captain Registration

```
1. User opens app → Login screen
2. User taps "Create Captain Account"
3. RegisterCaptain screen opens
   - Name
   - Email
   - Password
   - Position
   - Department
   - NO invite code field
4. User submits form
5. Account created → Auto login
6. Home screen shows "no vessel" state
7. User taps "Create Vessel"
8. User creates vessel → gets invite code
9. User is automatically linked to vessel as HOD
10. Home screen shows full content
```

### Flow 2: Crew Registration

```
1. User opens app → Login screen
2. User taps "Create Crew Account"
3. RegisterCrew screen opens
   - Name
   - Email
   - Password
   - Position
   - Department
   - Invite code (REQUIRED)
4. User enters valid invite code
5. User submits form
6. Account created → Automatically joins vessel
7. Auto login → Home screen shows full content
8. User has CREW role
```

---

## UI Components

### Login Screen

```
┌─────────────────────────────────┐
│         Welcome Back            │
│   Sign in to continue to Yachy  │
│                                 │
│  Email: [_________________]     │
│  Password: [_____________]      │
│                                 │
│  [     Sign In      ]           │
│                                 │
│  Don't have an account?         │
│                                 │
│  ┌─────────────────────────┐   │
│  │         ⚓               │   │
│  │      Captain            │   │
│  │  Create your vessel and │   │
│  │  invite your crew       │   │
│  │                         │   │
│  │ [Create Captain Account]│   │
│  └─────────────────────────┘   │
│                                 │
│  ┌─────────────────────────┐   │
│  │         👥              │   │
│  │     Crew Member         │   │
│  │  Join a vessel using    │   │
│  │  an invite code         │   │
│  │                         │   │
│  │ [Create Crew Account]   │   │
│  └─────────────────────────┘   │
└─────────────────────────────────┘
```

### Captain Registration Screen

```
┌─────────────────────────────────┐
│            ⚓                    │
│   Create Captain Account        │
│   Set up your account and       │
│   create your vessel            │
│                                 │
│  ℹ️ As a Captain, you'll create│
│  your vessel and receive an     │
│  invite code to share           │
│                                 │
│  Full Name: [______________]    │
│  Email: [__________________]    │
│  Password: [_______________]    │
│  Confirm: [________________]    │
│  Position: [_______________]    │
│                                 │
│  Department:                    │
│  [Deck] [Interior]             │
│  [Engineering] [Galley]         │
│                                 │
│  [Create Captain Account]       │
│                                 │
│  Already have an account?       │
│  [Sign In]                      │
└─────────────────────────────────┘
```

### Crew Registration Screen

```
┌─────────────────────────────────┐
│            👥                   │
│    Create Crew Account          │
│   Join your vessel using an     │
│   invite code                   │
│                                 │
│  ℹ️ You'll need an 8-character │
│  invite code from your captain  │
│                                 │
│  Full Name: [______________]    │
│  Email: [__________________]    │
│  Password: [_______________]    │
│  Confirm: [________________]    │
│  Position: [_______________]    │
│                                 │
│  Department:                    │
│  [Deck] [Interior]             │
│  [Engineering] [Galley]         │
│                                 │
│  Invite Code *: [________]      │
│  (Required)                     │
│                                 │
│  [Create Crew Account]          │
│                                 │
│  Already have an account?       │
│  [Sign In]                      │
│                                 │
│  Don't have an invite code?     │
│  Ask your captain or create a   │
│  captain account                │
└─────────────────────────────────┘
```

---

## Key Differences: Captain vs Crew

| Feature | Captain | Crew |
|---------|---------|------|
| Invite Code | ❌ Not shown | ✅ Required |
| Vessel Creation | After registration | N/A |
| Initial Role | None (until vessel created) | CREW |
| Vessel Access | After creating vessel | Immediate |
| Home Screen | "No vessel" initially | Full access |

---

## Database Behavior

### Captain Registration
```typescript
// Step 1: Create user (no vessel)
INSERT INTO users (
  name, email, position, department,
  role: 'CREW',  // Default role
  vessel_id: NULL  // No vessel yet
)

// Step 2: User creates vessel
INSERT INTO vessels (name, invite_code, ...)

// Step 3: Update user with vessel
UPDATE users SET 
  vessel_id = new_vessel_id,
  role = 'HOD'  // Upgrade to HOD
WHERE id = user_id
```

### Crew Registration
```typescript
// Single step: Create user with vessel
INSERT INTO users (
  name, email, position, department,
  role: 'CREW',
  vessel_id: (SELECT id FROM vessels WHERE invite_code = '...')
)
```

---

## Validation Rules

### Captain Registration
- ✅ Name required
- ✅ Email required (valid format)
- ✅ Password required (min 6 chars)
- ✅ Password confirmation match
- ✅ Position required
- ✅ Department required
- ❌ Invite code not needed

### Crew Registration
- ✅ Name required
- ✅ Email required (valid format)
- ✅ Password required (min 6 chars)
- ✅ Password confirmation match
- ✅ Position required
- ✅ Department required
- ✅ **Invite code required**
- ✅ **Invite code must be valid**
- ✅ **Invite code must not be expired**

---

## Error Handling

### Captain Registration Errors
```typescript
// Possible errors:
- "Email already in use"
- "Password too short"
- "Email rate limit exceeded" (see FIX_EMAIL_RATE_LIMIT.md)
- "Failed to create account"
```

### Crew Registration Errors
```typescript
// Possible errors:
- "Email already in use"
- "Password too short"
- "Invite code is required"
- "Invalid invite code"
- "Invite code has expired"
- "Email rate limit exceeded" (see FIX_EMAIL_RATE_LIMIT.md)
- "Failed to create account"
```

---

## API Methods Used

### Both Registration Types
```typescript
authService.signUp({
  email: string,
  password: string,
  name: string,
  position: string,
  department: string,
  inviteCode?: string,  // Required for crew, omitted for captain
  vesselId?: string,    // Not used in either flow
})
```

---

## Navigation Structure

```
AuthStack:
  - Login
  - RegisterCaptain (NEW)
  - RegisterCrew (NEW)
  - Register (legacy)
  - CreateVessel

MainStack (Authenticated):
  - Home
  - JoinVessel
  - CreateVessel
```

---

## Testing Checklist

### Test Captain Flow
- [ ] Open app → see Login screen
- [ ] See two account type cards
- [ ] Tap "Create Captain Account"
- [ ] See Captain registration form
- [ ] Notice: NO invite code field
- [ ] Fill in all fields
- [ ] Submit → account created
- [ ] Auto login → home screen
- [ ] See "no vessel" card
- [ ] Tap "Create Vessel"
- [ ] Create vessel → get invite code
- [ ] Verify vessel created
- [ ] Home screen shows full content

### Test Crew Flow
- [ ] Open app → see Login screen
- [ ] Tap "Create Crew Account"
- [ ] See Crew registration form
- [ ] Notice: Invite code field present and required
- [ ] Try to submit without invite code → error
- [ ] Enter invalid invite code → error
- [ ] Enter valid invite code
- [ ] Fill in all fields
- [ ] Submit → account created
- [ ] Auto login → home screen
- [ ] Home screen shows full content immediately
- [ ] Verify user is part of vessel

### Test Error Handling
- [ ] Try duplicate email → proper error
- [ ] Try short password → proper error
- [ ] Try invalid invite code → proper error
- [ ] Try expired invite code → proper error
- [ ] Verify all error messages are clear

---

## Files Modified

1. **LoginScreen.tsx**
   - Added two account type cards
   - Removed old "Register" button
   - Removed "Create New Vessel" button

2. **RegisterCaptainScreen.tsx** (NEW)
   - Captain-specific registration
   - No invite code field
   - Captain branding (⚓)

3. **RegisterCrewScreen.tsx** (NEW)
   - Crew-specific registration
   - Required invite code field
   - Crew branding (👥)

4. **RootNavigator.tsx**
   - Added RegisterCaptain screen
   - Added RegisterCrew screen
   - Updated navigation stack

5. **screens/index.ts**
   - Exported new screens

---

## Migration Notes

### Old Flow → New Flow

**Captain Path:**
```
Old: Login → "Create New Vessel" → CreateVessel → Register
New: Login → "Create Captain Account" → RegisterCaptain → Login → CreateVessel
```

**Crew Path:**
```
Old: Login → "Register" → Register (with invite code)
New: Login → "Create Crew Account" → RegisterCrew (with invite code)
```

### Backward Compatibility

The old `RegisterScreen` still exists but is not linked from UI. Can be:
- Kept for legacy support
- Removed if not needed
- Used as fallback

---

## Next Steps

1. **Fix Email Rate Limit**
   - Follow guide in `FIX_EMAIL_RATE_LIMIT.md`
   - Disable email confirmation for development
   - Set up custom SMTP for production

2. **Test Both Flows**
   - Create captain account
   - Create vessel
   - Get invite code
   - Create crew account with that code
   - Verify both users can access vessel

3. **Future Enhancements**
   - Add "Forgot Password" flow
   - Add email verification (once rate limit fixed)
   - Add social login (Google, Apple)
   - Add profile photos during registration

---

## Summary

✅ **What's Working:**
- Two clear registration paths
- Captain: No invite code needed
- Crew: Invite code required
- Clear UI distinction between roles
- Proper validation for each type

⚠️ **Needs Attention:**
- Email rate limit (see FIX_EMAIL_RATE_LIMIT.md)
- Test with real Supabase instance
- Verify invite code validation works

🚀 **Ready For:**
- Testing on device
- User feedback
- Production deployment (after email fix)
