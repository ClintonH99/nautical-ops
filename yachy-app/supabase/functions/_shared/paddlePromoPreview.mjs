import { BillingError, approvedPrice, paddleRequest, validatePrice } from './paddle.mjs';
import { findTrialDiscount } from './paddleTrialDiscount.mjs';
import { billingEnvironmentArgs } from './paddleRollout.mjs';

// No subscription PATCH, transaction creation, or redemption. Only reads and
// Paddle's calculation-only pricing-preview operation are allowed here.
export async function previewTrialPromo(config, client, body, address, fetcher, now = Date.now) {
  if (typeof body.promoCode !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(body.promoCode))
    throw new BillingError('Enter a valid promo code.', 400);
  approvedPrice(body.tier, body.billingPeriod);
  const { data: billing, error } = await client.rpc('get_paddle_trial_billing', {
    p_vessel_id: body.vesselId,
    ...billingEnvironmentArgs(config.environment),
  });
  if (
    error ||
    billing?.environment !== config.environment ||
    !/^sub_[a-z0-9]{26}$/.test(billing.subscription_id || '') ||
    !/^ctm_[a-z0-9]{26}$/.test(billing.customer_id || '') ||
    billing.plan_tier !== body.tier ||
    billing.billing_period !== body.billingPeriod ||
    !Number.isFinite(Date.parse(body.trialEnd)) ||
    Date.parse(body.trialEnd) !== Date.parse(billing.trial_end)
  )
    throw new BillingError('Refresh your current trial before checking a promo code.', 409);
  const subscription = await paddleRequest(
    config,
    `/subscriptions/${billing.subscription_id}`,
    {},
    fetcher
  );
  const item = subscription.items?.[0];
  const end = Date.parse(subscription.current_billing_period?.ends_at);
  if (
    subscription.id !== billing.subscription_id ||
    subscription.customer_id !== billing.customer_id ||
    subscription.status !== 'trialing' ||
    subscription.collection_mode !== 'automatic' ||
    subscription.scheduled_change != null ||
    subscription.items?.length !== 1 ||
    item.quantity !== 1 ||
    item.price?.id !== config.prices[body.tier]?.[body.billingPeriod] ||
    !Number.isFinite(end) ||
    end <= now() ||
    end !== Date.parse(billing.trial_end)
  )
    throw new BillingError(
      'The trial has changed. Refresh your plan before checking the code.',
      409
    );
  validatePrice(item.price, body.tier, body.billingPeriod);
  const discount = await findTrialDiscount(config, subscription, body.promoCode, fetcher, now);
  if (
    typeof discount.recur !== 'boolean' ||
    (discount.maximum_recurring_intervals !== null &&
      (!Number.isSafeInteger(discount.maximum_recurring_intervals) ||
        discount.maximum_recurring_intervals < 1))
  )
    throw new BillingError('The promotion duration could not be verified.', 502);
  const data = await paddleRequest(
    config,
    '/pricing-preview',
    {
      method: 'POST',
      body: JSON.stringify({
        currency_code: 'USD',
        address,
        discount_id: discount.id,
        items: [{ price_id: item.price.id, quantity: 1 }],
      }),
    },
    fetcher
  );
  const line = data.details?.line_items?.[0];
  const totals = line?.totals;
  if (
    data.currency_code !== 'USD' ||
    data.discount_id !== discount.id ||
    data.details?.line_items?.length !== 1 ||
    line?.price?.id !== item.price.id ||
    line.quantity !== 1 ||
    !totals ||
    !['subtotal', 'discount', 'tax', 'total'].every(
      (key) =>
        typeof totals[key] === 'string' &&
        /^\d+$/.test(totals[key]) &&
        Number.isSafeInteger(Number(totals[key]))
    ) ||
    totals.subtotal !== approvedPrice(body.tier, body.billingPeriod).amount ||
    Number(totals.discount) <= 0 ||
    Number(totals.discount) > Number(totals.subtotal) ||
    Number(totals.total) !== Number(totals.subtotal) - Number(totals.discount) + Number(totals.tax)
  )
    throw new BillingError('The discounted total could not be verified. Please try again.', 502);
  validatePrice(line.price, body.tier, body.billingPeriod);
  return {
    environment: config.environment,
    currency: 'USD',
    billingPeriod: body.billingPeriod,
    countryCode: address.country_code,
    postalCode: address.postal_code ?? '',
    trialEnd: new Date(end).toISOString(),
    expiresAt: new Date(
      Math.min(
        now() + 5 * 60 * 1000,
        end,
        discount.expires_at ? Date.parse(discount.expires_at) : Infinity
      )
    ).toISOString(),
    promo: {
      code: discount.code,
      recur: discount.recur,
      maximumRecurringIntervals: discount.maximum_recurring_intervals,
    },
    quote: {
      tier: body.tier,
      baseCents: Number(totals.subtotal),
      discountCents: Number(totals.discount),
      taxCents: Number(totals.tax),
      totalCents: Number(totals.total),
    },
  };
}
