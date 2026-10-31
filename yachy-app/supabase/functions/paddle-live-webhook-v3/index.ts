import { createClient } from 'npm:@supabase/supabase-js@2';
import { withModernSupabaseKeys } from '../_shared/modernSupabaseKeys.mjs';
import { createPaddleLiveWebhookHandler } from '../_shared/paddleLiveWebhook.mjs';

const runtimeEnv = withModernSupabaseKeys((name: string) => Deno.env.get(name));
// The tested handler uses the previous variable name internally. Map only that
// name to the new credential; never read or fall back to the retired value.
const replacementEnv = (name: string) => runtimeEnv(
  name === 'PADDLE_LIVE_WEBHOOK_V2_SECRET' ? 'PADDLE_LIVE_WEBHOOK_V3_SECRET' : name
);
Deno.serve(createPaddleLiveWebhookHandler({ getEnv: replacementEnv, createClient }));
