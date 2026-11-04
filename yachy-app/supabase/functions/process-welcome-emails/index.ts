import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { withModernSupabaseKeys } from '../_shared/modernSupabaseKeys.mjs';
import { isTrustedNotificationRequest } from '../send-trip-push/internal-auth.ts';
import { processWelcomeEmails } from '../_shared/welcomeEmailWorker.mjs';

const env = withModernSupabaseKeys((name: string) => Deno.env.get(name));
Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  if (!isTrustedNotificationRequest(request.headers, undefined, env('NOTIFICATION_WORKER_SECRET')))
    return new Response(null, { status: 401 });
  try {
    const raw = await request.text();
    if (raw.length > 1024) return new Response(null, { status: 413 });
    if (raw && Object.keys(JSON.parse(raw)).length) return new Response(null, { status: 400 });
    const admin = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!);
    return Response.json(await processWelcomeEmails({ admin, getEnv: env }));
  } catch {
    console.error('Welcome email worker unavailable');
    return Response.json({ error: 'Welcome email processing unavailable' }, { status: 503 });
  }
});
