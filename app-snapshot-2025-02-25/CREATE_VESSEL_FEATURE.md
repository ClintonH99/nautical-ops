# Create Vessel Feature

**Added:** February 13, 2026  
**Feature:** First-time user vessel creation with automatic invite code generation

---

## 🎯 What This Feature Does

Allows first-time users to easily create their yacht profile and get an invite code without needing to manually set up database entries or contact an admin.

---

## ✨ Key Features

### 1. **Create New Vessel**
- Users can create a new vessel/yacht profile
- Generates unique 8-character invite code automatically
- Code is valid for 1 year
- Simple, user-friendly interface

### 2. **Automatic Invite Code Generation**
- Codes are generated using non-ambiguous characters (no 0/O, 1/I confusion)
- Format: 8 uppercase characters (e.g., `YACHT2026`, `M8Y3X4P7`)
- Automatically checks for uniqueness
- Displays expiry date

### 3. **Easy Sharing**
- Share button to distribute code via messages, email, etc.
- Visual display of invite code
- Clear instructions for crew members

### 4. **Seamless Registration Flow**
- After creating vessel, automatically navigate to registration
- Invite code is pre-filled in registration form
- No need to manually copy/paste

---

## 📱 User Flow

### For Vessel Owners/Captains (First Time)

1. **Open App** → Tap "Create New Vessel" on login screen
2. **Enter Vessel Name** → e.g., "M/Y Excellence"
3. **Get Invite Code** → System generates unique code
4. **Share Code** → Use share button to send to crew
5. **Register Account** → Continue to registration with code

### For Crew Members

1. **Open App** → Tap "Register"
2. **Enter Invite Code** → Code provided by captain/owner
3. **Complete Registration** → Join the vessel team

OR if they don't have a code:

1. **Open App** → Tap "Register"
2. **Tap "Create Vessel"** → Set up their own vessel
3. **Get Invite Code** → Share with their crew

---

## 🔧 Technical Implementation

### New Files Created

1. **`src/services/vessel.ts`**
   - Vessel management service
   - Invite code generation logic
   - Database operations for vessels

2. **`src/screens/CreateVesselScreen.tsx`**
   - UI for creating new vessel
   - Success screen with invite code display
   - Share functionality

### Modified Files

1. **`src/navigation/RootNavigator.tsx`**
   - Added CreateVessel screen to navigation

2. **`src/screens/LoginScreen.tsx`**
   - Added "Create New Vessel" button

3. **`src/screens/RegisterScreen.tsx`**
   - Added "Create Vessel" link
   - Handle invite code parameter from navigation

4. **`src/components/Button.tsx`**
   - Added "text" variant for inline links

5. **`src/screens/index.ts`**
   - Export CreateVesselScreen

---

## 🎨 UI/UX Features

### Create Vessel Screen
- Ship emoji (🚢) for visual appeal
- Clear value proposition
- Simple one-field form
- Helpful information card

### Success Screen
- Celebration icon (⚓)
- Large, prominent invite code display
- Monospace font for code clarity
- Expiry date shown
- Action buttons (Share, Continue)

### Integration Points
- Login screen: "Create New Vessel" button
- Register screen: "Create Vessel" link under invite code field
- Seamless navigation between screens

---

## 🧪 Testing the Feature

### Step 1: Start the App
```bash
cd yachy-app
npm start
```

### Step 2: Test on Phone
1. Scan QR code with Expo Go
2. App opens to Login screen
3. See "Create New Vessel" button

### Step 3: Create Vessel
1. Tap "Create New Vessel"
2. Enter vessel name (e.g., "M/Y Test")
3. Tap "Create Vessel & Get Invite Code"
4. See success screen with unique code

### Step 4: Share & Register
1. Tap "Share Invite Code" to test sharing
2. Tap "Continue to Registration"
3. Verify code is pre-filled
4. Complete registration

### Step 5: Verify in Database
1. Go to Supabase Dashboard
2. Table Editor → `vessels`
3. See your new vessel with invite code

---

## 📊 Database Integration

Works with existing vessels table:
- Generates unique `invite_code`
- Sets `invite_expiry` to 1 year from creation
- Creates vessel record immediately available for registration

---

## 🎯 Benefits

### For Users
✅ **No waiting** - Instant vessel creation  
✅ **No admin needed** - Self-service onboarding  
✅ **Easy sharing** - Built-in share functionality  
✅ **Clear process** - Step-by-step guidance

### For the App
✅ **Better onboarding** - Removes friction  
✅ **Scalability** - No manual vessel setup  
✅ **User adoption** - Easier to get started  
✅ **Self-service** - Reduces support needs

---

## 💡 Usage Tips

### For Captains/Owners
- Create vessel before inviting crew
- Share code via your preferred method (WhatsApp, email, etc.)
- Keep code accessible for new crew members
- Code valid for 1 year

### For Developers
- Invite codes are 8 characters (easy to type if needed)
- Uses non-ambiguous characters only
- Automatically checks uniqueness
- Expiry can be extended in future updates

---

## 🆘 Troubleshooting

**Problem:** Can't see "Create New Vessel" button  
**Solution:** Make sure app is updated and RootNavigator includes the screen

**Problem:** "Failed to create vessel"  
**Solution:** Check Supabase connection, verify `.env` file has correct credentials

**Problem:** Invite code already exists  
**Solution:** Very rare - app will retry automatically. If persists, check database

---

## ✅ Feature Complete!

This feature is fully implemented and ready to use. Users can now:
- ✅ Create vessels from the app
- ✅ Generate invite codes automatically
- ✅ Share codes with crew
- ✅ Register with pre-filled codes

---

**Next Steps:** Test the feature on your phone and create your first vessel!

**Last Updated:** February 13, 2026
