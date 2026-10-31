import { createClient } from 'npm:@supabase/supabase-js@2';
import { withModernSupabaseKeys } from '../_shared/modernSupabaseKeys.mjs';

const runtimeEnv = withModernSupabaseKeys((name: string) => Deno.env.get(name));
import { createPaddleWebhookHandler } from '../_shared/paddleWebhook.mjs';

const sandboxHandler = createPaddleWebhookHandler({ getEnv: runtimeEnv, createClient });

// Live events must use the replacement endpoint and its independent V2 secret.
// Retiring the Paddle destination alone does not prevent forged direct requests.
Deno.serve((request: Request) => {
  if (runtimeEnv('PADDLE_ENV') !== 'sandbox') {
    return Response.json({ error: 'This billing endpoint is retired' }, { status: 410 });
  }
  return sandboxHandler(request);
});
