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
  });
}

export { Sentry };
