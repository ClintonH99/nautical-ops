import { createClient } from 'npm:@supabase/supabase-js@2';
import { withBrowserCors } from '../_shared/browserCors.ts';
import { createPaddlePricingHandler } from '../_shared/paddlePricing.mjs';

Deno.serve(
  withBrowserCors(
    createPaddlePricingHandler({
      getEnv: (key: string) => Deno.env.get(key),
      createClient,
    })
  )
);
