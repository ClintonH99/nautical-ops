import { createClient } from 'npm:@supabase/supabase-js@2';
import { withModernSupabaseKeys } from '../_shared/modernSupabaseKeys.mjs';
import { withBrowserCors } from '../_shared/browserCors.ts';
import { createPaddleReactivationHandler } from '../_shared/paddleReactivation.mjs';

const getEnv = withModernSupabaseKeys((key: string) => Deno.env.get(key));
Deno.serve(withBrowserCors(createPaddleReactivationHandler({ getEnv, createClient }), { getEnv }));
