import { createClient } from 'npm:@supabase/supabase-js@2';
import { withModernSupabaseKeys } from '../_shared/modernSupabaseKeys.mjs';

const runtimeEnv = withModernSupabaseKeys((name: string) => Deno.env.get(name));
import { withBrowserCors } from '../_shared/browserCors.ts';
import { createPaddleCheckoutHandler } from '../_shared/paddleCheckout.mjs';

Deno.serve(
  withBrowserCors(
    createPaddleCheckoutHandler({
      getEnv: (key: string) => runtimeEnv(key),
      createClient,
    })
  )
);
