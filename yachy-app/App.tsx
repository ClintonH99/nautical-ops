/**
 * Nautical Ops - Main Entry Point
 * Professional yacht operations management app
 */

import './src/lib/sentry';
import { useEffect } from 'react';
import { Platform, View, Text, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import { useFonts } from 'expo-font';
import { RootNavigator } from './src/navigation/RootNavigator';
import { isSupabaseConfigured } from './src/services/supabase';

function AppContent() {
  const [fontsLoaded] = useFonts({
    'AlexBrush-Regular': require('./assets/fonts/AlexBrush-Regular.ttf'),
  });

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const style = document.createElement('style');
      style.textContent = `
        input:focus, textarea:focus, select:focus { outline: none; }
      `;
      document.head.appendChild(style);
      return () => {
        document.head.removeChild(style);
      };
    }
  }, []);

  // The signature font is decorative - don't hold the whole app on it.
  // Anything using it falls back until it loads a moment later.

  if (!isSupabaseConfigured()) {
    const configHint =
      Platform.OS === 'web'
        ? 'Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to your .env (local) or your web host’s environment (e.g. Vercel), then rebuild.'
        : 'This build was made without Supabase env vars. In expo.dev → your project → Environment variables, add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY for the production environment, then run a new EAS iOS/Android build and install it from TestFlight or the store. See docs/EAS_TESTFLIGHT_SUPABASE.md in the repo.';
    return (
      <View style={styles.configError}>
        <Text style={styles.configTitle}>Configuration Required</Text>
        <Text style={styles.configText}>{configHint}</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <RootNavigator />
      <StatusBar style="auto" />
    </GestureHandlerRootView>
  );
}

// Sentry is deliberately disabled in Expo Go/development. Only wrap the app
// after Sentry.init has run so development does not emit an initialization error.
export default process.env.EXPO_PUBLIC_SENTRY_DSN && !__DEV__
  ? Sentry.wrap(AppContent)
  : AppContent;

const styles = StyleSheet.create({
  configError: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  configTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 12,
    textAlign: 'center',
  },
  configText: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 360,
  },
});
