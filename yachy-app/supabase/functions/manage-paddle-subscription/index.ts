import { createClient } from 'npm:@supabase/supabase-js@2';
import { withBrowserCors } from '../_shared/browserCors.ts';
import { createPaddleManagementHandler } from '../_shared/paddleManagement.mjs';

Deno.serve(
  withBrowserCors(
    createPaddleManagementHandler({ getEnv: (key: string) => Deno.env.get(key), createClient }),
    { getEnv: (key: string) => Deno.env.get(key) }
  )
);
