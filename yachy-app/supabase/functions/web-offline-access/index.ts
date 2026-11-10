import { createClient } from 'npm:@supabase/supabase-js@2.95.3';
import { withModernSupabaseKeys } from '../_shared/modernSupabaseKeys.mjs';
import { createOfflineAccessHandler } from '../_shared/offlineAccess.mjs';
const getEnv = withModernSupabaseKeys((name: string) => Deno.env.get(name));
Deno.serve(createOfflineAccessHandler({ getEnv, createClient }));
