import { BillingError, paddleResponse } from './paddle.mjs';

/** Server API evidence only. A free trial or zero-value card setup is not payment. */
export async function previouslyPaid(config, event, fetcher = fetch) {
  const dueAt = Date.parse(event.period_start);
  if (!Number.isFinite(dueAt) || dueAt > Date.parse(event.occurred_at))
    throw new BillingError('Renewal date could not be verified', 503);
  let after;
  const seen = new Set();
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({
      subscription_id: event.subscription_id,
      customer_id: event.customer_id,
      status: 'completed',
      per_page: '30',
      order_by: 'id[DESC]',
    });
    if (after) query.set('after', after);
    const result = await paddleResponse(config, `/transactions?${query}`, {}, fetcher);
    if (!Array.isArray(result.data) || typeof result.meta?.pagination?.has_more !== 'boolean')
      throw new BillingError('Payment history is incomplete', 503);
    for (const transaction of result.data) {
      if (
        transaction.subscription_id !== event.subscription_id ||
        transaction.customer_id !== event.customer_id ||
        transaction.status !== 'completed' ||
        !Array.isArray(transaction.payments) ||
        !/^\d+$/.test(transaction.details?.totals?.grand_total)
      )
        throw new BillingError('Payment history binding mismatch', 503);
      const paidBeforeRenewal = transaction.payments?.some(
        (payment) =>
          payment.status === 'captured' &&
          /^[1-9]\d*$/.test(payment.amount) &&
          Date.parse(payment.captured_at) < dueAt
      );
      if (
        transaction.collection_mode === 'automatic' &&
        ['web', 'api', 'subscription_recurring', 'subscription_update'].includes(
          transaction.origin
        ) &&
        /^[1-9]\d*$/.test(transaction.details?.totals?.grand_total) &&
        paidBeforeRenewal
      )
        return true;
    }
    if (!result.meta.pagination.has_more) return false;
    after = result.data.at(-1)?.id;
    if (!/^txn_[a-z0-9]{26}$/.test(after || '') || seen.has(after))
      throw new BillingError('Payment history pagination is incomplete', 503);
    seen.add(after);
  }
  throw new BillingError('Payment history needs reconciliation', 503);
}
