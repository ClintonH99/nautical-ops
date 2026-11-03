import { paddleConfig, paddleRequest, paddleResponse, planForPrice } from './paddle.mjs';
import { billingMessages, sendStoredEmail } from './billingEmails.mjs';

const checked = async (promise) => {
  const { data, error } = await promise;
  if (error) throw new Error('Email database operation failed');
  return data;
};

export async function loadBillingEvidence(admin, config, job, fetcher = fetch) {
  const link = await checked(
    admin
      .from('paddle_subscription_links')
      .select('subscription_id,customer_id,vessel_id,checkout_id,environment')
      .eq('subscription_id', job.subscription_id)
      .single()
  );
  if (link.environment !== 'live') throw new Error('Not a live subscription');
  const vessel = await checked(
    admin
      .from('vessel_subscriptions')
      .select('vessel_id,plan_tier,billing_period,paddle_subscription_id,paddle_customer_id')
      .eq('vessel_id', link.vessel_id)
      .single()
  );
  if (
    vessel.paddle_subscription_id !== link.subscription_id ||
    vessel.paddle_customer_id !== link.customer_id
  )
    return null;
  const intent = await checked(
    admin
      .from('paddle_checkout_intents')
      .select('user_id,vessel_id,environment')
      .eq('id', link.checkout_id)
      .single()
  );
  if (intent.vessel_id !== link.vessel_id || intent.environment !== 'live')
    throw new Error('Billing owner mismatch');
  // Send only to the captain who started this subscription, never an arbitrary
  // first crew member or a recipient supplied in the request body.
  const recipient = await checked(
    admin.from('users').select('id,name,email,role,vessel_id').eq('id', intent.user_id).single()
  );
  if (recipient.role !== 'CAPTAIN_MOV' || recipient.vessel_id !== link.vessel_id)
    throw new Error('Billing captain changed; review required');
  const named = await checked(
    admin.from('vessels').select('name').eq('id', link.vessel_id).single()
  );
  vessel.name = named.name;
  const subscription = await paddleRequest(
    config,
    `/subscriptions/${link.subscription_id}`,
    {},
    fetcher
  );
  if (subscription.id !== link.subscription_id || subscription.customer_id !== link.customer_id)
    throw new Error('Provider binding mismatch');
  if (subscription.items?.length !== 1 || subscription.items[0].quantity !== 1)
    throw new Error('Unexpected subscription items');
  const priceId = subscription.items[0].price?.id;
  let plan;
  try {
    plan = planForPrice(config.prices, priceId);
  } catch {
    plan = planForPrice(config.paidPrices || {}, priceId);
  }
  if (plan.tier !== vessel.plan_tier || plan.period !== vessel.billing_period)
    throw new Error('Subscription plan is not synchronized');
  const transactions = [];
  let after;
  const seen = new Set();
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({
      subscription_id: link.subscription_id,
      customer_id: link.customer_id,
      status: 'completed',
      per_page: '30',
      order_by: 'id[DESC]',
      'created_at[GTE]': job.not_before,
    });
    if (after) query.set('after', after);
    const result = await paddleResponse(config, `/transactions?${query}`, {}, fetcher);
    if (!Array.isArray(result.data) || typeof result.meta?.pagination?.has_more !== 'boolean')
      throw new Error('Incomplete transactions');
    transactions.push(...result.data);
    if (!result.meta.pagination.has_more)
      return { subscription, transactions, link, vessel, recipient, since: job.not_before };
    after = result.data.at(-1)?.id;
    if (!/^txn_[a-z0-9]{26}$/.test(after || '') || seen.has(after))
      throw new Error('Invalid pagination');
    seen.add(after);
  }
  throw new Error('Payment history needs review');
}

export async function processBillingEmails({
  admin,
  getEnv,
  fetcher = fetch,
  now = () => Date.now(),
}) {
  const jobs = await checked(admin.rpc('claim_billing_email_jobs'));
  const result = { jobs: jobs.length, accepted: 0, review: 0, failed: 0 };
  if (!jobs.length) return result;
  const config = paddleConfig(getEnv);
  if (config.environment !== 'live') throw new Error('Live email worker only');
  for (const job of jobs) {
    let status = 'ok';
    let delay = 15 * 60 * 1000;
    try {
      const evidence = await loadBillingEvidence(admin, config, job, fetcher);
      if (!evidence) {
        status = 'replaced';
        delay = 365 * 86400000;
      } else {
        const messages = billingMessages({ ...evidence, now: now() });
        for (const item of messages) {
          await checked(
            admin.from('billing_email_deliveries').upsert(
              {
                email_key: item.key,
                subscription_id: job.subscription_id,
                recipient_id: evidence.recipient.id,
                kind: item.kind,
                message: item.message,
              },
              { onConflict: 'email_key', ignoreDuplicates: true }
            )
          );
        }
        // Retry immutable messages only while their underlying event/state is
        // still verified. Never send an expired trial or changed-recipient claim.
        const verifiedKeys = new Set(messages.map((item) => item.key));
        const rows = await checked(
          admin
            .from('billing_email_deliveries')
            .select('*')
            .eq('subscription_id', job.subscription_id)
            .eq('status', 'pending')
            .order('created_at')
            .limit(10)
        );
        for (const row of rows) {
          if (
            row.recipient_id !== evidence.recipient.id ||
            row.message.to !== evidence.recipient.email ||
            !verifiedKeys.has(row.email_key)
          ) {
            await checked(
              admin
                .from('billing_email_deliveries')
                .update({ status: 'review' })
                .eq('email_key', row.email_key)
            );
            status = 'review';
            result.review++;
            continue;
          }
          const existing = await checked(
            admin
              .from('billing_email_deliveries')
              .update({ first_attempt_at: new Date(now()).toISOString() })
              .eq('email_key', row.email_key)
              .is('first_attempt_at', null)
              .select('first_attempt_at')
          );
          if (!row.first_attempt_at) row.first_attempt_at = existing[0]?.first_attempt_at;
          if (!row.first_attempt_at) throw new Error('Concurrent delivery state changed');
          const sent = await sendStoredEmail(row, {
            apiKey: getEnv('RESEND_API_KEY'),
            fetcher,
            now: now(),
          });
          if (sent.review) {
            await checked(
              admin
                .from('billing_email_deliveries')
                .update({ status: 'review' })
                .eq('email_key', row.email_key)
            );
            result.review++;
            status = 'review';
            continue;
          }
          await checked(
            admin
              .from('billing_email_deliveries')
              .update({
                status: 'accepted',
                provider_id: sent.id,
                accepted_at: new Date(now()).toISOString(),
              })
              .eq('email_key', row.email_key)
          );
          result.accepted++;
        }
        if (['canceled', 'paused'].includes(evidence.subscription.status)) delay = 86400000;
      }
    } catch {
      result.failed++;
      status = 'retry';
      delay = Math.min(60, 5 * 2 ** Math.min(job.attempts, 4)) * 60000;
      console.error('Billing email job needs retry');
    }
    await checked(
      admin
        .from('billing_email_jobs')
        .update({
          lease_id: null,
          lease_until: null,
          available_at: new Date(now() + delay).toISOString(),
          last_result: status,
          ...(status === 'ok' ? { attempts: 0 } : {}),
        })
        .eq('subscription_id', job.subscription_id)
        .eq('lease_id', job.lease_id)
    );
  }
  return result;
}
