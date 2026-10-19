import { createClient } from 'npm:@supabase/supabase-js@2';
import { withBrowserCors } from '../_shared/browserCors.ts';
import { createPaddleRecoveryHandler } from '../_shared/paddleRecovery.mjs';

Deno.serve(
  withBrowserCors(
    createPaddleRecoveryHandler({ getEnv: (key: string) => Deno.env.get(key), createClient }),
    { getEnv: (key: string) => Deno.env.get(key) }
  )
);
