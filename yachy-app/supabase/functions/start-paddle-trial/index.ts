import { createClient } from 'npm:@supabase/supabase-js@2';
import { withBrowserCors } from '../_shared/browserCors.ts';
import { createPaddleTrialHandler } from '../_shared/paddleTrial.mjs';

Deno.serve(
  withBrowserCors(
    createPaddleTrialHandler({
      getEnv: (key: string) => Deno.env.get(key),
      createClient,
    })
  )
);
