/**
 * Supabase Client Configuration
 *
 * Before using, you need to:
 * 1. Create a Supabase project at https://supabase.com
 * 2. Get your project URL and anon key
 * 3. Create a .env file with SUPABASE_URL and SUPABASE_ANON_KEY
 */

import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-url-polyfill/auto';

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'your-anon-key';

// Detect missing/placeholder credentials so UI can show actionable message
const isPlaceholder =
  !SUPABASE_URL ||
  !SUPABASE_ANON_KEY ||
  SUPABASE_URL === 'https://your-project.supabase.co' ||
  SUPABASE_ANON_KEY === 'your-anon-key';
if (__DEV__ && isPlaceholder) {
  console.warn(
    '[Nautical Ops] Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

// Debug: verify correct Supabase project on web (remove after confirming login works)
if (typeof window !== 'undefined') {
  console.log('[Nautical Ops] Supabase URL:', SUPABASE_URL);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// Helper function to check if Supabase is configured
export const isSupabaseConfigured = () => {
  return (
    SUPABASE_URL !== 'https://your-project.supabase.co' && SUPABASE_ANON_KEY !== 'your-anon-key'
  );
};
