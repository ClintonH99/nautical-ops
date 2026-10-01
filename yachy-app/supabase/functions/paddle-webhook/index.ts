import { createClient } from 'npm:@supabase/supabase-js@2';
import { createPaddleWebhookHandler } from '../_shared/paddleWebhook.mjs';

Deno.serve(
  createPaddleWebhookHandler({ getEnv: (key: string) => Deno.env.get(key), createClient })
);
