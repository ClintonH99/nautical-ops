import { createClient } from 'npm:@supabase/supabase-js@2';
import { withModernSupabaseKeys } from '../_shared/modernSupabaseKeys.mjs';

const runtimeEnv = withModernSupabaseKeys((name: string) => Deno.env.get(name));
import { withBrowserCors } from '../_shared/browserCors.ts';
import { createPaddleRecoveryHandler } from '../_shared/paddleRecovery.mjs';

Deno.serve(
  withBrowserCors(
    createPaddleRecoveryHandler({ getEnv: (key: string) => runtimeEnv(key), createClient }),
    { getEnv: (key: string) => runtimeEnv(key) }
  )
);
