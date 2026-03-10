/**
 * Nautical Ops - Main Entry Point
 * Professional yacht operations management app
 */

import './src/lib/sentry';
import { useEffect } from 'react';
import { Platform, View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { isSupabaseConfigured } from './src/services/supabase';

function AppContent() {
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const style = document.createElement('style');
      style.textContent = `
        input:focus, textarea:focus, select:focus { outline: none; }
      `;
      document.head.appendChild(style);
      return () => { document.head.removeChild(style); };
    }
  }, []);

  if (!isSupabaseConfigured()) {
    return (
      <View style={styles.configError}>
        <Text style={styles.configTitle}>Configuration Required</Text>
        <Text style={styles.configText}>
          Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to your .env
          file (local) or Vercel Environment Variables (production), then restart.
        </Text>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <>
      <RootNavigator />
      <StatusBar style="auto" />
    </>
  );
}

// Wrap with Sentry for crash reporting (no-op when DSN not configured)
export default Sentry.wrap(AppContent);

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
