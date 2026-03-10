# Support and Incident Process

Phase 5 of Enterprise App Launch Readiness. Defines how users report issues and how security/operational incidents are handled.

---

## User Support Flow

### Contact Support (In-App)

- **Location**: Settings → Support → Contact Support
- **Action**: Opens device email client to `support@nautical-ops.com`
- **Fallback**: If `mailto:` fails (e.g. some web browsers), an alert shows the email address

### Support Email

- **Address**: support@nautical-ops.com
- **Setup**: Use Addy.io, Migadu, Zoho, or your preferred provider
- **Response SLA**: Define internally (e.g. 24–48 hours for non-critical)

---

## Security Incidents

### If a User Reports a Security Concern

1. **Acknowledge** – Reply to the user confirming receipt
2. **Triage** – Assess severity:
   - **Critical**: Data breach, unauthorized access, credential leak
   - **High**: Suspicious activity, account compromise
   - **Medium**: Vulnerability report, policy concern
3. **Contain** – If applicable: revoke tokens, disable accounts, rotate secrets
4. **Investigate** – Review Supabase logs, auth events, Edge Function logs
5. **Remediate** – Fix root cause; update RLS, Edge Functions, or app code
6. **Communicate** – Inform affected users if required by law or policy

### Escalation Contacts

| Role | Responsibility |
|------|----------------|
| App owner | Primary contact for store and security |
| Supabase project | Dashboard access, SQL, Edge Function logs |

### Store Contacts

- **App Store Connect**: App Review, Resolution Center
- **Google Play Console**: Policy status, support contact

---

## Crash and Error Reporting (Sentry)

### Setup

1. Create a project at [sentry.io](https://sentry.io)
2. Add to `.env` (local) or EAS/Vercel env vars:
   ```
   EXPO_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
   ```
3. Sentry initializes only when DSN is set and `__DEV__` is false
4. PII is not sent by default (`sendDefaultPii: false`)

### What Gets Captured

- Unhandled JavaScript errors
- Native crashes (when Sentry SDK is configured)
- Optional: `Sentry.captureException()` for manual reporting

### Privacy

- No email, name, or other PII is sent unless explicitly added
- User ID can be set for debugging (e.g. `Sentry.setUser({ id: userId })`) – only use hashed IDs if needed

---

## Operational Incidents

### App Down or Unusable

1. Check [Supabase Status](https://status.supabase.com)
2. Check EAS/Expo status
3. Review recent deployments
4. If backend: redeploy Edge Functions, check RLS
5. Communicate via status page or in-app message if possible

---

## References

- [ADMIN/Authorizations](Authorizations/README.md) – Roles and permissions
- [STORE_SUBMISSION_CHECKLIST.md](../STORE_SUBMISSION_CHECKLIST.md) – Store metadata and support URL
