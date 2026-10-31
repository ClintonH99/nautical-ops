import { BillingError, paddleRequest } from './paddle.mjs';

// A payment-method transaction cannot redeem a promotion. Apply it to the
// authenticated vessel's existing trial, never to a browser-supplied ID.
export async function applyTrialDiscount(config, subscription, code, fetcher, now) {
  if (code === undefined || code === '') return subscription;
  if (typeof code !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(code))
    throw new BillingError('Enter a valid promo code.', 400);
  const matches = await paddleRequest(
    config,
    `/discounts?code=${encodeURIComponent(code)}&status=active`,
    {},
    fetcher
  );
  const discount = Array.isArray(matches) && matches.length === 1 ? matches[0] : null;
  const item = subscription.items[0];
  const alreadyApplied = discount && subscription.discount?.id === discount.id;
  if (
    !discount ||
    !/^dsc_[a-z0-9]{26}$/.test(discount.id) ||
    discount.code?.toLowerCase() !== code.toLowerCase() ||
    discount.status !== 'active' ||
    !discount.enabled_for_checkout ||
    (discount.expires_at &&
      (!Number.isFinite(Date.parse(discount.expires_at)) ||
        Date.parse(discount.expires_at) <= now())) ||
    (!alreadyApplied &&
      discount.usage_limit != null &&
      discount.times_used >= discount.usage_limit) ||
    (discount.restrict_to != null &&
      (!Array.isArray(discount.restrict_to) ||
        !discount.restrict_to.some((id) => id === item.price.id || id === item.price.product_id)))
  )
    throw new BillingError(
      'This promo code is unavailable for this plan. No payment was taken.',
      409
    );
  if (subscription.discount && !alreadyApplied)
    throw new BillingError(
      'A promotion is already attached to this trial. Contact support before changing it.',
      409
    );
  if (alreadyApplied) return subscription;
  const updated = await paddleRequest(
    config,
    `/subscriptions/${subscription.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        discount: { id: discount.id, effective_from: 'next_billing_period' },
        proration_billing_mode: 'do_not_bill',
      }),
    },
    fetcher
  );
  if (
    updated.id !== subscription.id ||
    updated.customer_id !== subscription.customer_id ||
    updated.status !== 'trialing' ||
    updated.collection_mode !== subscription.collection_mode ||
    updated.current_billing_period?.ends_at !== subscription.current_billing_period?.ends_at ||
    updated.next_billed_at !== subscription.next_billed_at ||
    updated.scheduled_change != null ||
    updated.items?.length !== 1 ||
    updated.items[0].price?.id !== item.price.id ||
    updated.items[0].quantity !== 1 ||
    updated.discount?.id !== discount.id
  )
    throw new BillingError(
      'The promotion could not be confirmed. Refresh your plan and contact support before retrying.',
      503
    );
  return updated;
}
