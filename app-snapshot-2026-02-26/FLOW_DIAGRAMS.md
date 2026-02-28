# User Flow Diagrams

## Old Flow (Before Changes)

```
┌─────────────┐
│ Login Screen│
└──────┬──────┘
       │
       ├─────── Register ──────►┌──────────────────┐
       │                        │ Register Screen  │
       │                        │ (Invite Required)│
       │                        └────────┬─────────┘
       │                                 │
       │                                 ▼
       │                        ┌──────────────────┐
       │                        │   Create Account │
       │                        │   (With Vessel)  │
       │                        └────────┬─────────┘
       │                                 │
       │                                 ▼
       └─────── Sign In ───────►┌──────────────────┐
                                 │   Home Screen    │
                                 │  (With Vessel)   │
                                 └──────────────────┘
```

**Problem:** Users couldn't register without an invite code

---

## New Flow (After Changes)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Login Screen                              │
└────┬────────────┬────────────┬─────────────────────────────────┘
     │            │            │
     │            │            └─── Create Vessel ─────┐
     │            │                                     │
     │            └─── Register ──────┐                │
     │                                │                │
     │                                ▼                ▼
     │                     ┌────────────────┐  ┌─────────────┐
     │                     │ Register Screen│  │   Create    │
     │                     │ (No Invite     │  │   Vessel    │
     │                     │  Required)     │  │   Screen    │
     │                     └───────┬────────┘  └──────┬──────┘
     │                             │                   │
     │                             ▼                   │
     │                     ┌────────────────┐          │
     │                     │ Create Account │          │
     │                     │ (No Vessel)    │          │
     │                     └───────┬────────┘          │
     │                             │                   │
     └─── Sign In ────────────────┐│                   │
                                  ││                   │
                                  ▼▼                   │
                         ┌──────────────────┐          │
                         │   Home Screen    │◄─────────┘
                         └────────┬─────────┘   (Auto-assign
                                  │              as HOD)
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
          ┌──────────────────┐      ┌──────────────────┐
          │  Has Vessel?     │      │   No Vessel?     │
          │                  │      │                  │
          │ • View Tasks     │      │ • Join Vessel    │
          │ • View Inventory │      │ • Create Vessel  │
          │ • View Calendar  │      │                  │
          └──────────────────┘      └────────┬─────────┘
                                              │
                                    ┌─────────┴─────────┐
                                    │                   │
                                    ▼                   ▼
                          ┌──────────────┐  ┌──────────────┐
                          │ Join Vessel  │  │Create Vessel │
                          │   Screen     │  │   Screen     │
                          └──────┬───────┘  └──────────────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │ Enter Invite │
                          │     Code     │
                          └──────┬───────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │  Join Vessel │
                          │   Success    │
                          └──────┬───────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │ Home Screen  │
                          │ (With Vessel)│
                          └──────────────┘
```

---

## Detailed Flow: Register Without Vessel

```
User Opens App
      │
      ▼
┌──────────────┐
│ Login Screen │
└──────┬───────┘
       │
       │ Taps "Register"
       ▼
┌─────────────────────────┐
│   Register Screen       │
│                         │
│   Fields:               │
│   • Name               │
│   • Email              │
│   • Password           │
│   • Confirm Password   │
│   • Position           │
│   • Department         │
│                         │
│   ℹ️ You can join a    │
│   vessel after         │
│   creating account     │
│                         │
│   [Create Account]     │
└──────────┬──────────────┘
           │
           │ Submits form
           ▼
    ┌──────────────┐
    │   Supabase   │
    │   Auth.SignUp│
    └──────┬───────┘
           │
           │ Success
           ▼
    ┌──────────────┐
    │ Insert User  │
    │ vessel_id=NULL│
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │ Auto Login   │
    └──────┬───────┘
           │
           ▼
┌──────────────────────────┐
│    Home Screen           │
│                          │
│    Welcome, [Name]!      │
│                          │
│  ┌────────────────────┐ │
│  │        ⚓          │ │
│  │ You're not part   │ │
│  │ of a vessel yet   │ │
│  │                   │ │
│  │ [Join Vessel]     │ │
│  │ [Create Vessel]   │ │
│  └────────────────────┘ │
│                          │
│  [Sign Out]              │
└──────────────────────────┘
```

---

## Detailed Flow: Join Vessel

```
Home Screen (No Vessel)
      │
      │ Taps "Join Vessel"
      ▼
┌──────────────────────────┐
│  Join Vessel Screen      │
│                          │
│         ⚓               │
│   Join a Vessel          │
│                          │
│  ┌────────────────────┐ │
│  │ How to get code:   │ │
│  │ • Ask captain      │ │
│  │ • 8 characters     │ │
│  │ • Expires in 1yr   │ │
│  └────────────────────┘ │
│                          │
│  Invite Code:            │
│  [________]              │
│                          │
│  [Join Vessel]           │
│                          │
│  Don't have a vessel?    │
│  [Create Your Own]       │
│                          │
│  [Back to Home]          │
└──────────┬───────────────┘
           │
           │ Enters code & submits
           ▼
    ┌──────────────┐
    │   Validate   │
    │  Invite Code │
    └──────┬───────┘
           │
     ┌─────┴─────┐
     │           │
     ▼           ▼
  Valid?      Invalid?
     │           │
     │           └──► ❌ Show Error Alert
     │                 "Invalid/Expired Code"
     │
     │ Valid code found
     ▼
┌─────────────┐
│ Update User │
│ vessel_id   │
└──────┬──────┘
       │
       │ Success
       ▼
┌──────────────┐
│ ✅ Success   │
│    Alert     │
└──────┬───────┘
       │
       ▼
┌──────────────────────────┐
│   Home Screen            │
│                          │
│   Welcome, [Name]!       │
│                          │
│  ┌────────────────────┐ │
│  │  Active Tasks: 0   │ │
│  │  Upcoming Trips: 0 │ │
│  └────────────────────┘ │
│                          │
│  Coming Soon:            │
│  ✅ Tasks Management     │
│  ✅ Inventory Tracking   │
│  ✅ Watch Duties         │
│  ...                     │
│                          │
│  [Sign Out]              │
└──────────────────────────┘
```

---

## Detailed Flow: Create Vessel

```
Login Screen
      │
      │ Taps "Create New Vessel"
      ▼
┌──────────────────────────┐
│  Create Vessel Screen    │
│                          │
│         ⚓               │
│   Create New Vessel      │
│                          │
│  Vessel Name:            │
│  [____________]          │
│                          │
│  ℹ️ You'll be the captain│
│   and get an invite code │
│   to share with crew     │
│                          │
│  [Create Vessel]         │
│                          │
│  [Back]                  │
└──────────┬───────────────┘
           │
           │ Submits vessel name
           ▼
    ┌──────────────┐
    │   Generate   │
    │ Invite Code  │
    └──────┬───────┘
           │
           │ e.g., "ABC12345"
           ▼
    ┌──────────────┐
    │ Insert Vessel│
    │ to Database  │
    └──────┬───────┘
           │
           │ Success
           ▼
┌──────────────────────────┐
│  Success Screen          │
│                          │
│    ✅ Vessel Created!    │
│                          │
│  Your Invite Code:       │
│  ┌────────────────────┐ │
│  │    ABC12345        │ │
│  │  [Copy] [Share]    │ │
│  └────────────────────┘ │
│                          │
│  Share this with crew    │
│                          │
│  [Continue to Register]  │
└──────────┬───────────────┘
           │
           │ Taps "Continue"
           ▼
┌──────────────────────────┐
│   Register Screen        │
│                          │
│   Fields:                │
│   • Name                │
│   • Email               │
│   • Password            │
│   • Position            │
│   • Department          │
│                          │
│   Invite Code:           │
│   [ABC12345] (disabled)  │
│                          │
│   ⚓ Vessel Creator      │
│   You'll be HOD          │
│                          │
│   [Create Account]       │
└──────────┬───────────────┘
           │
           │ Submits
           ▼
    ┌──────────────┐
    │ Create User  │
    │ role=HOD     │
    │ vesselId=... │
    └──────┬───────┘
           │
           ▼
┌──────────────────────────┐
│   Home Screen            │
│   (Full Access)          │
│                          │
│   You're the captain! ⚓ │
└──────────────────────────┘
```

---

## State Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     USER STATES                             │
└─────────────────────────────────────────────────────────────┘

┌──────────────────┐
│  Not Registered  │
│  (Anonymous)     │
└────────┬─────────┘
         │
         │ Register (no invite code)
         ▼
┌──────────────────┐
│   Registered     │
│   No Vessel      │
│   (vesselId=NULL)│
└────────┬─────────┘
         │
    ┌────┴────┐
    │         │
    │         │ Join Vessel (with invite code)
    │         ▼
    │    ┌──────────────────┐
    │    │   Registered     │
    │    │   With Vessel    │
    │    │   (CREW role)    │
    │    └──────────────────┘
    │
    │ Create Vessel
    ▼
┌──────────────────┐
│   Registered     │
│   With Vessel    │
│   (HOD role)     │
└──────────────────┘
```

---

## Navigation Map

```
┌─────────────────────────────────────────────────────────────┐
│                    UNAUTHENTICATED                          │
└─────────────────────────────────────────────────────────────┘

Login Screen ◄─┐
    │          │
    ├─► Register Screen
    │          │
    └─► Create Vessel Screen ──┘

┌─────────────────────────────────────────────────────────────┐
│                     AUTHENTICATED                           │
└─────────────────────────────────────────────────────────────┘

Home Screen (No Vessel)
    │
    ├─► Join Vessel Screen ──────► Success ──┐
    │                                         │
    └─► Create Vessel Screen ────► Success ──┤
                                              │
                                              ▼
                                    Home Screen (With Vessel)
```

---

## Error Handling Flow

```
Join Vessel Screen
      │
      │ Submit Invite Code
      ▼
┌──────────────┐
│  Validation  │
└──────┬───────┘
       │
   ┌───┴───┐
   │       │
   ▼       ▼
Empty?   Valid Format?
   │         │
   │ Yes     │ No
   ▼         ▼
❌ Error   ❌ Error
"Enter    "Invalid
code"     format"
   │         │
   └────┬────┘
        │
        │ Valid format
        ▼
  ┌──────────────┐
  │ Check DB for │
  │ Invite Code  │
  └──────┬───────┘
         │
     ┌───┴───┐
     │       │
     ▼       ▼
  Found?  Not Found?
     │       │
     │       ▼
     │    ❌ Error
     │    "Invalid
     │     code"
     │
     │ Check expiry
     ▼
  Expired?
     │
  ┌──┴──┐
  │     │
  ▼     ▼
Yes   No
  │     │
  │     └──► ✅ Success
  │            Update vessel_id
  │            Show success alert
  │            Navigate to Home
  ▼
❌ Error
"Expired
 code"
```

---

## Database State Changes

```
┌─────────────────────────────────────────────────────────┐
│              USER RECORD IN DATABASE                    │
└─────────────────────────────────────────────────────────┘

1. After Registration (No Vessel):
   ┌──────────────────────────┐
   │ id: uuid-123             │
   │ email: user@email.com    │
   │ name: John Doe           │
   │ position: Deckhand       │
   │ department: DECK         │
   │ role: CREW               │
   │ vessel_id: NULL          │ ◄── NULL allowed now
   │ created_at: timestamp    │
   └──────────────────────────┘

2. After Joining Vessel:
   ┌──────────────────────────┐
   │ id: uuid-123             │
   │ email: user@email.com    │
   │ name: John Doe           │
   │ position: Deckhand       │
   │ department: DECK         │
   │ role: CREW               │
   │ vessel_id: uuid-456      │ ◄── Updated
   │ updated_at: timestamp    │
   └──────────────────────────┘

3. After Creating Vessel:
   ┌──────────────────────────┐
   │ id: uuid-789             │
   │ email: captain@email.com │
   │ name: Jane Captain       │
   │ position: Captain        │
   │ department: DECK         │
   │ role: HOD                │ ◄── Auto HOD role
   │ vessel_id: uuid-999      │ ◄── Vessel they created
   │ created_at: timestamp    │
   └──────────────────────────┘
```

---

## Component Hierarchy

```
RootNavigator
│
├─── (Unauthenticated Stack)
│    ├─── LoginScreen
│    ├─── RegisterScreen
│    └─── CreateVesselScreen
│
└─── (Authenticated Stack)
     ├─── HomeScreen
     │    ├─── (If no vessel)
     │    │    ├─── NoVesselCard
     │    │    │    ├─── JoinVesselButton
     │    │    │    └─── CreateVesselButton
     │    │    └─── LogoutButton
     │    │
     │    └─── (If has vessel)
     │         ├─── StatsCards
     │         ├─── FeaturesList
     │         ├─── DevInfo
     │         └─── LogoutButton
     │
     ├─── JoinVesselScreen
     │    ├─── InfoCard
     │    ├─── InviteCodeInput
     │    ├─── JoinButton
     │    ├─── CreateVesselButton
     │    └─── BackButton
     │
     └─── CreateVesselScreen
          ├─── VesselNameInput
          ├─── CreateButton
          └─── BackButton
```

This visual documentation should help understand the complete flow!
