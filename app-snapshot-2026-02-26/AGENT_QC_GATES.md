# 3 Quality Control Gates for Agent Sessions

**Run these 3 gates at the start of each agent session** to ensure the app works before making changes.

---

## Gate 1: TypeScript Check
```bash
cd yachy-app && npx tsc --noEmit
```
**Pass:** No errors  
**Fail:** Fix TypeScript errors before proceeding. Broken types often cause runtime bugs.

---

## Gate 2: App Starts Successfully
```bash
cd yachy-app && npm start
```
**Pass:** Expo dev server starts (QR code / "Waiting on expo...")  
**Fail:** Fix startup errors (missing deps, config, syntax) before editing.

---

## Gate 3: Critical Paths Load
**Manually verify (or run smoke test):**
- Login / auth flow works
- Home screen loads without crash
- Tasks screen and Maintenance Log load
- No red error screens in development

**Pass:** Core screens load without crash  
**Fail:** Fix blocking issues before adding features.

---

## Quick One-Liner (Gates 1 + 2)
```bash
cd "/Users/clintonhandford/Desktop/Yachy App/yachy-app" && npx tsc --noEmit && echo "✅ TS OK" && npm start
```

---

## Optional: Add to GitHub Actions
Add a CI workflow that runs Gate 1 on every push. See `.github/workflows/ci.yml` for the TypeScript gate.
