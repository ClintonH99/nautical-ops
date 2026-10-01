import { createClient } from 'npm:@supabase/supabase-js@2';
import { withBrowserCors } from '../_shared/browserCors.ts';
import { createPaddleCheckoutHandler } from '../_shared/paddleCheckout.mjs';

Deno.serve(
  withBrowserCors(
    createPaddleCheckoutHandler({
      getEnv: (key: string) => Deno.env.get(key),
      createClient,
    })
  )
);
