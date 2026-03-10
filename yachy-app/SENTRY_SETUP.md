# Sentry Setup (Crash Reporting)

Phase 5 adds Sentry for crash and error reporting. It is **optional** and only activates when configured.

## Quick Start

1. Create a project at [sentry.io](https://sentry.io)
2. Copy your DSN from **Project Settings → Client Keys (DSN)**
3. Add to your environment:

   **Local (.env):**
   ```
   EXPO_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
   ```

   **EAS Build (production):**
   ```bash
   eas secret:create --name EXPO_PUBLIC_SENTRY_DSN --value "https://xxx@xxx.ingest.sentry.io/xxx"
   ```

   **Vercel (if deploying web):** Add in Environment Variables

4. Rebuild the app. Sentry only initializes in **production** (`__DEV__ === false`) when DSN is set.

## What's Included

- **Error boundary**: App is wrapped with `Sentry.wrap()` to capture unhandled JS errors
- **No PII**: `sendDefaultPii: false` — we do not send email, name, or other personal data
- **Performance**: `tracesSampleRate: 0.2` — 20% of transactions for performance monitoring

## Source Maps (Optional)

For readable stack traces in Sentry, upload source maps during build. Add the Sentry Expo plugin to `app.json`:

```json
{
  "expo": {
    "plugins": [
      [
        "@sentry/react-native/expo",
        {
          "organization": "your-org-slug",
          "project": "your-project-slug"
        }
      ]
    ]
  }
}
```

Then set `SENTRY_AUTH_TOKEN` in your environment (create at sentry.io → Settings → Auth Tokens). The plugin uploads source maps during `eas build`.

## Verify

After deploying with DSN set:

1. Trigger an error (e.g. add a test button that throws)
2. Check your Sentry project for the event

## References

- [Sentry React Native Docs](https://docs.sentry.io/platforms/react-native/)
- [ADMIN/SUPPORT_AND_INCIDENTS.md](../ADMIN/SUPPORT_AND_INCIDENTS.md)
