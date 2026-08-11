/**
 * Sentry crash and error reporting
 * Initializes only when EXPO_PUBLIC_SENTRY_DSN is set.
 * Add to .env: EXPO_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
 */

import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (DSN && !__DEV__) {
  Sentry.init({
    dsn: DSN,
    // Avoid logging PII per Phase 5 requirements
    sendDefaultPii: false,
    // Sample rate for performance traces (reduce in high-traffic prod)
    tracesSampleRate: 0.2,
    // Only enable in production
    enabled: !__DEV__,
    // Structured logs via Sentry.logger.*
    enableLogs: true,
    // Session Replay - masks text/images by default, consistent with the
    // no-PII stance above
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    integrations: [Sentry.mobileReplayIntegration()],
  });
}

export { Sentry };
