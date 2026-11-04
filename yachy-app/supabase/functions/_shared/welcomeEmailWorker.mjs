import { welcomeMessage } from './welcomeEmails.mjs';

const HOUR = 60 * 60 * 1000;
const STATES = new Set([
  'sent',
  'delivered',
  'delivery_delayed',
  'bounced',
  'complained',
  'failed',
  'suppressed',
  'opened',
  'clicked',
]);

// No recipient addresses, bodies, credentials or raw provider errors in logs.
export async function processWelcomeEmails({
  admin,
  getEnv,
  fetchImpl = fetch,
  now = () => Date.now(),
}) {
  const key = getEnv('RESEND_API_KEY');
  if (!key) throw new Error('Email configuration unavailable');
  const { data: jobs, error } = await admin.rpc('claim_welcome_email_jobs');
  if (error) throw new Error('Welcome queue unavailable');
  const totals = { accepted: 0, retried: 0, review: 0, failed: 0, checked: 0, errors: 0 };
  for (const job of jobs || []) {
    const update = async (values) => {
      const { data, error } = await admin
        .from('welcome_email_jobs')
        .update(values)
        .eq('user_id', job.user_id)
        .eq('lease_id', job.lease_id)
        .select('user_id');
      if (error || data?.length !== 1) throw new Error('Welcome lease or persistence unavailable');
    };
    const finish = (values) => update({ ...values, lease_id: null, lease_until: null });
    const request = async (path, options = {}) => {
      const response = await fetchImpl('https://api.resend.com' + path, {
        ...options,
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      const body = await response.json().catch(() => ({}));
      return { response, body };
    };
    try {
      if (job.status === 'accepted') {
        // Tracking must NEVER cause a second send, even when the API key cannot read emails.
        const { response, body } = await request('/emails/' + encodeURIComponent(job.provider_id));
        const denied = response.status === 401 || response.status === 403;
        const state =
          response.ok && body.id === job.provider_id && STATES.has(body.last_event)
            ? body.last_event
            : job.delivery_state;
        await finish({
          delivery_state: state,
          delivery_checked_at: new Date(now()).toISOString(),
          available_at: new Date(now() + 5 * 60000).toISOString(),
          ...(denied ? { delivery_checks: 12 } : {}),
          last_result: response.ok
            ? 'delivery_status_checked'
            : denied
              ? 'delivery_tracking_permission_unavailable'
              : 'delivery_status_retry',
        });
        totals.checked++;
        continue;
      }
      if (job.status !== 'pending') continue;
      // Provider idempotency expires after 24h. Stop conservatively at 23h; never
      // silently create a second message if an earlier accepted response was lost.
      if (
        job.attempts > 12 ||
        (job.first_attempt_at && now() - Date.parse(job.first_attempt_at) >= 23 * HOUR)
      ) {
        await finish({ status: 'review', last_result: 'retry_limit_manual_review' });
        totals.review++;
        continue;
      }
      const { data: user, error: userError } = await admin
        .from('users')
        .select('email')
        .eq('id', job.user_id)
        .maybeSingle();
      if (userError) throw new Error('Recipient lookup unavailable');
      if (!user || user.email !== job.recipient.email) {
        await finish({ status: 'review', last_result: 'recipient_changed_or_missing' });
        totals.review++;
        continue;
      }
      const message = job.message || welcomeMessage(job);
      // Save exact payload BEFORE first network attempt. Subsequent releases,
      // profile edits and logo changes cannot change an in-flight idempotent send.
      if (!job.message || !job.first_attempt_at)
        await update({
          message,
          first_attempt_at: job.first_attempt_at || new Date(now()).toISOString(),
        });
      const { response, body } = await request('/emails', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'welcome-v1/' + job.user_id },
        body: JSON.stringify(message),
      });
      if (response.ok && typeof body.id === 'string' && body.id.length > 0) {
        await finish({
          status: 'accepted',
          provider_id: body.id,
          accepted_at: new Date(now()).toISOString(),
          available_at: new Date(now() + 60000).toISOString(),
          last_result: 'provider_accepted',
        });
        totals.accepted++;
      } else if (
        [400, 401, 403, 404, 422].includes(response.status) ||
        (response.status === 409 && body.name === 'invalid_idempotent_request')
      ) {
        await finish({ status: 'failed', last_result: 'provider_rejected_' + response.status });
        totals.failed++;
      } else {
        await finish({
          available_at: new Date(
            now() + Math.min(60, 2 ** Math.min(job.attempts, 6)) * 60000
          ).toISOString(),
          last_result: 'provider_retry_' + response.status,
        });
        totals.retried++;
      }
    } catch {
      // Includes a timeout after possible acceptance or a failed DB write. Retain
      // the same payload/key; the persisted lease expires and cron retries safely.
      totals.errors++;
      console.error('Welcome email job deferred; safe retry or review pending');
    }
  }
  return totals;
}
