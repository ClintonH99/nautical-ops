# 🚀 QUICK START - Captain/Crew Registration

## ⚡ What Changed

**New:** Two separate registration paths on login screen

```
┌─────────────────────────────────┐
│          Login Screen           │
├─────────────────────────────────┤
│  ⚓ Captain Account              │
│  Create vessel, no invite code  │
│  [Create Captain Account]       │
├─────────────────────────────────┤
│  👥 Crew Account                │
│  Join vessel with invite code   │
│  [Create Crew Account]          │
└─────────────────────────────────┘
```

---

## 🚨 CRITICAL: Fix Email Rate Limit FIRST

### Quick Fix (30 seconds)

1. Go to https://supabase.com
2. Open your project
3. Authentication → Settings
4. **Toggle OFF** "Enable email confirmations"
5. Click Save

**Done!** Now you can test registration.

---

## 🧪 Quick Test

### Test Captain (No Invite Code)
```
1. Tap "Create Captain Account" (⚓)
2. Fill form (NO invite code field)
3. Submit → Success
4. Login → See "Create Vessel" option
5. Create vessel → Become HOD
```

### Test Crew (Invite Code Required)
```
1. Tap "Create Crew Account" (👥)
2. Fill form + Invite code (REQUIRED)
3. Try without code → Error ✅
4. Add valid code → Submit → Success
5. Login → Immediate vessel access
```

---

## 📱 Try It Now

```bash
cd /Users/clintonhandford/Desktop/Yachy\ App/yachy-app
npm start
# Connect via Expo Go
```

---

## 📚 Full Documentation

| Issue | Read This |
|-------|-----------|
| Email rate limit | `FIX_EMAIL_RATE_LIMIT.md` |
| How flows work | `CAPTAIN_CREW_REGISTRATION.md` |
| Quick overview | `NEXT_AGENT_BRIEF.md` |
| This session | `SESSION_SUMMARY_CAPTAIN_CREW.md` |

---

## ✅ Checklist

- [ ] Fix email rate limit (Supabase)
- [ ] Test captain registration
- [ ] Test crew registration  
- [ ] Test invite code validation
- [ ] Report any issues

---

## 🆘 Common Issues

**"Email rate limit exceeded"**
→ Disable email confirmation (see above)

**"Invite code required"**
→ This is correct for crew accounts

**"Invalid invite code"**
→ Get valid code by creating vessel as captain

---

**Status:** ✅ Code Complete  
**Action:** Fix email rate limit + Test

Good luck! 🚢
