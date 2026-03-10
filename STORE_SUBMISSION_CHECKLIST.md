# Store Submission Checklist

Phase 4 of Enterprise App Launch Readiness. Follow this checklist before submitting Nautical Ops to the App Store and Play Store.

---

## Prerequisites

- [ ] Phase 1–3 complete (security, code quality, tests)
- [ ] EAS project linked: `eb067a9d-d949-45a2-b3a1-15867c609436`
- [ ] Bundle ID (iOS): `com.nauticalops.app`
- [ ] Package name (Android): `com.nauticalops.app`
- [ ] Privacy Policy live at: https://nautical-ops.com/privacy
- [ ] Terms of Service live (ensure linked in app)

---

## App Store (Apple)

### App Store Connect Setup

- [ ] Create app in [App Store Connect](https://appstoreconnect.apple.com)
- [ ] Bundle ID: `com.nauticalops.app`
- [ ] **App Information**: Name, subtitle, category (Business or Productivity)
- [ ] **Metadata**: Description, keywords (max 100 chars), support URL
- [ ] **Pricing**: Free or paid; regions
- [ ] **App Privacy**: See [Data Declarations](#data-declarations-app-store--play) below

### Screenshots (iOS)

Apple requires screenshots for each device size. Capture from simulator or device.

| Device | Resolution | Notes |
|--------|------------|-------|
| iPhone 6.7" | 1290 × 2796 | iPhone 15 Pro Max |
| iPhone 6.5" | 1284 × 2778 | iPhone 14 Plus |
| iPhone 5.5" | 1242 × 2208 | iPhone 8 Plus |
| iPad Pro 12.9" | 2048 × 2732 | If supports tablet |

- [ ] 3–10 screenshots per device size
- [ ] No placeholder or debug content
- [ ] Show key flows: Login, Home, Tasks, vessel management

### Capabilities

- [ ] Sign in with Apple (enabled in app.json)
- [ ] Push Notifications (if used)
- [ ] Camera (for QR/barcode scanning)

### Build Upload

```bash
cd yachy-app
eas build --platform ios --profile production
```

- [ ] Build succeeds
- [ ] Upload to App Store Connect (automatic if submit config set)
- [ ] Or: Download and upload manually via Transporter

### TestFlight (Required Before Submit)

- [ ] Add internal testers
- [ ] Add external testers (if needed)
- [ ] Run full QA on TestFlight build
- [ ] Fix any issues before submitting for review

### Submit for Review

- [ ] Select build
- [ ] Complete all metadata and screenshots
- [ ] App Review information (contact, demo account if needed)
- [ ] Submit

---

## Play Store (Google)

### Play Console Setup

- [ ] Create app in [Google Play Console](https://play.google.com/console)
- [ ] Package name: `com.nauticalops.app`
- [ ] **Main store listing**: Title (30 chars), short description (80 chars), full description (4000 chars)
- [ ] **Graphics**: App icon (512×512), feature graphic (1024×500)
- [ ] **Data safety**: See [Data Declarations](#data-declarations-app-store--play) below

### Screenshots (Android)

| Type | Minimum size |
|------|--------------|
| Phone | 320–3840 px on short side |
| 7" Tablet | 1200 px on short side (if supported) |
| 10" Tablet | 1600 px on short side (if supported) |

- [ ] 2–8 screenshots (phone)
- [ ] No placeholder content

### Content Rating

- [ ] Complete [content rating questionnaire](https://support.google.com/googleplay/android-developer/answer/9888170)
- [ ] For Nautical Ops (business/crew app): typically Everyone or Everyone 10+

### Target Audience

- [ ] Age group (e.g., 18+ if crew-only, or broader)
- [ ] Target countries/regions

### Build Upload

```bash
cd yachy-app
eas build --platform android --profile production
```

- [ ] Build succeeds (AAB for Play Store)
- [ ] Upload AAB to Play Console → Production or Internal testing

### Internal Testing (Recommended)

- [ ] Create internal testing track
- [ ] Add testers
- [ ] Run full QA on internal build

### Submit for Review

- [ ] Complete all store listing requirements
- [ ] Submit for review

---

## Data Declarations (App Store & Play)

Use this when filling out App Privacy (Apple) and Data Safety (Google).

### Data Collected

| Data Type | Purpose | Shared | Required |
|-----------|---------|--------|----------|
| Email | Account creation, sign-in | No | Yes |
| Name | Profile, vessel membership | Other crew on vessel | Yes |
| Password | Authentication | No | Yes |
| Profile photo | Optional avatar | Other crew on vessel | No |
| Position/Department | Role, vessel operations | Other crew on vessel | Yes |
| Device identifiers | Push notifications (if used) | No | No |

### Data Practices

- **Storage**: Supabase (data processor); US/EU regions per project
- **Retention**: Account data retained until user requests deletion
- **Encryption**: TLS in transit; encryption at rest (Supabase)
- **Third parties**: Supabase (auth, database), Google (OAuth), Apple (Sign in with Apple)

### Apple App Privacy "Nutrition Labels"

When prompted, select:

- **Contact Info**: Email address (account management)
- **Identifiers**: User ID (if applicable)
- **User Content**: Photos (if profile photo or task attachments uploaded)
- **Other**: Name, position, department

### Google Data Safety Form

- Data collected: Name, email, profile photo (optional)
- Purpose: App functionality, account management
- Data shared: With other users (crew on same vessel)
- Data encrypted in transit: Yes

---

## EAS Submit (Optional)

To automate submission after build:

1. **iOS**: Set `appleId` and `ascAppId` in `eas.json` submit.production.ios
2. **Android**: Create [Google Play service account](https://developers.google.com/android-publisher/getting_started) and save key as `google-service-account.json`
3. Run: `eas submit --platform ios --latest` or `eas submit --platform android --latest`

---

## Pre-Submission Verification

- [ ] No `__DEV__`-only features visible in production build
- [ ] No debug/test accounts or placeholder content
- [ ] Auth flows work (Apple, Google, email/password)
- [ ] Privacy Policy URL works in app
- [ ] Terms of Service accessible

---

## References

- [Expo EAS Build](https://docs.expo.dev/build/introduction/)
- [Expo EAS Submit](https://docs.expo.dev/submit/introduction/)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Play Store Policy Center](https://play.google.com/about/developer-content-policy/)
- [ADMIN/App Design](ADMIN/App%20Design/) — visual specs for screenshots
