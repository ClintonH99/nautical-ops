import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { withModernSupabaseKeys } from '../_shared/modernSupabaseKeys.mjs';
import { isTrustedNotificationRequest } from '../send-trip-push/internal-auth.ts';
import { processBillingEmails, loadBillingEvidence } from '../_shared/billingEmailWorker.mjs';
import { paddleConfig } from '../_shared/paddle.mjs';
import { billingMessages } from '../_shared/billingEmails.mjs';

const env = withModernSupabaseKeys((name: string) => Deno.env.get(name));
Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  if (!isTrustedNotificationRequest(request.headers, undefined, env('NOTIFICATION_WORKER_SECRET')))
    return new Response(null, { status: 401 });
  try {
    if (env('PADDLE_ENV') !== 'live' || !env('RESEND_API_KEY'))
      throw new Error('Email configuration unavailable');
    const admin = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!);
    const raw = await request.text();
    if (raw.length > 1024) return new Response(null, { status: 413 });
    const body = raw ? JSON.parse(raw) : {};
    if (body.mode === 'preview' && /^sub_[a-z0-9]{26}$/.test(body.subscriptionId || '')) {
      const { data: job, error } = await admin
        .from('billing_email_jobs')
        .select('*')
        .eq('subscription_id', body.subscriptionId)
        .single();
      if (error) throw new Error('Email job unavailable');
      const evidence = await loadBillingEvidence(admin, paddleConfig(env), job);
      if (!evidence) return Response.json({ replaced: true });
      const messages = billingMessages(evidence);
      // Read-only diagnostic. No recipients, credentials, payment/card details,
      // bodies or provider tokens are returned or logged.
      return Response.json({
        preview: true,
        status: evidence.subscription.status,
        kinds: messages.map((m) => m.kind),
        subjects: messages.map((m) => m.message.subject),
        trialEnd: evidence.subscription.current_billing_period?.ends_at,
      });
    }
    if (Object.keys(body).length) return new Response(null, { status: 400 });
    const result = await processBillingEmails({ admin, getEnv: env });
    return Response.json(result);
  } catch {
    console.error('Billing email worker failed');
    return Response.json({ error: 'Billing email processing unavailable' }, { status: 503 });
  }
});
