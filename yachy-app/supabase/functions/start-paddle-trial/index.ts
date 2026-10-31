import { createClient } from 'npm:@supabase/supabase-js@2';
import { withModernSupabaseKeys } from '../_shared/modernSupabaseKeys.mjs';

const runtimeEnv = withModernSupabaseKeys((name: string) => Deno.env.get(name));
import { withBrowserCors } from '../_shared/browserCors.ts';
import { createPaddleTrialHandler } from '../_shared/paddleTrial.mjs';

Deno.serve(
  withBrowserCors(
    createPaddleTrialHandler({
      getEnv: (key: string) => runtimeEnv(key),
      createClient,
    }),
    { getEnv: (key: string) => runtimeEnv(key) }
  )
);
