/**
 * Sentry crash and error reporting
 * Initializes only when EXPO_PUBLIC_SENTRY_DSN is set.
 * Add to .env: EXPO_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
 */

import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
export const isSentryEnabled = Boolean(DSN) && !__DEV__;

// React Navigation cannot be connected automatically because its container is
// created inside RootNavigator. Export one shared integration so Sentry can
// name performance traces and breadcrumbs after the screen the user visited.
export const sentryNavigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: true,
});

if (isSentryEnabled) {
  Sentry.init({
    dsn: DSN,
    environment: (Constants.expoConfig?.extra?.appEnv as string | undefined) || 'production',
    // Avoid logging PII per Phase 5 requirements
    sendDefaultPii: false,
    // Record crash-free users/sessions in Release Health, not only individual
    // error events. These are lightweight session envelopes, not replays.
    enableAutoSessionTracking: true,
    // Be explicit about the native protections relied on for TestFlight and
    // App Store builds.
    enableNativeCrashHandling: true,
    enableWatchdogTerminationTracking: true,
    enableAppHangTracking: true,
    // Sample rate for performance traces (reduce in high-traffic prod)
    tracesSampleRate: 0.2,
    // Only enable in production
    enabled: true,
    // Structured logs via Sentry.logger.*
    enableLogs: true,
    // Session Replay - masks text/images by default, consistent with the
    // no-PII stance above
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    integrations: [sentryNavigationIntegration, Sentry.mobileReplayIntegration()],
  });
}

type SentryUserContext = {
  id: string;
  role?: string | null;
  vesselId?: string | null;
};

/**
 * Attach only privacy-safe identifiers to reports. Names and email addresses
 * are deliberately excluded, while the user UUID lets support correlate
 * repeated failures from the same account.
 */
export const setSentryUserContext = (user: SentryUserContext | null): void => {
  if (!isSentryEnabled) return;

  if (!user) {
    Sentry.setUser(null);
    Sentry.setTags({ user_role: 'signed_out', vessel_id: 'none' });
    return;
  }

  Sentry.setUser({ id: user.id });
  Sentry.setTags({
    user_role: user.role || 'unknown',
    vessel_id: user.vesselId || 'none',
  });
};

export { Sentry };
