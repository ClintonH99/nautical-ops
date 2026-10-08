import { createClient } from 'npm:@supabase/supabase-js@2';
import { withBrowserCors } from '../_shared/browserCors.ts';
import { createPaddleTrialPaymentHandler } from '../_shared/paddleTrialPayment.mjs';

Deno.serve(
  withBrowserCors(
    createPaddleTrialPaymentHandler({ getEnv: (key: string) => Deno.env.get(key), createClient })
  )
);
