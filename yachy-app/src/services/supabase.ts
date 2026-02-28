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

// TODO: Replace with your Supabase credentials
// For now using placeholder values - you'll need to set these up
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'your-anon-key';

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
    SUPABASE_URL !== 'https://your-project.supabase.co' &&
    SUPABASE_ANON_KEY !== 'your-anon-key'
  );
};
