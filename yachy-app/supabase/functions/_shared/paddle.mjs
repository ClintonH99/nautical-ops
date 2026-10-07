// Server-only Paddle primitives. Never accept price IDs or amounts from a browser.
const amounts = {
  '1_5': 7999,
  '6_10': 8999,
  '11_15': 11999,
  '16_25': 14999,
  '26_40': 19999,
  '40_plus': 24999,
};
const periods = {
  monthly: [1, 100],
  '3_months': [3, 95],
  '6_months': [6, 92],
  '12_months': [12, 90],
};
export class BillingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function approvedPrice(tier, period) {
  if (!Object.hasOwn(amounts, tier) || !Object.hasOwn(periods, period))
    throw new BillingError('Unknown plan');
  const [months, factor] = periods[period];
  return { amount: String(Math.round((amounts[tier] * months * factor) / 100)), months };
}
export function paddleConfig(get) {
  const environment = get('PADDLE_ENV');
  if (!['sandbox', 'live'].includes(environment))
    throw new BillingError('Billing environment is not configured', 503);
  // Do not fall back from sandbox to a live key, or guess an environment.
  const apiKey = get(environment === 'live' ? 'PADDLE_LIVE_API_KEY' : 'PADDLE_SANDBOX_API_KEY');
  let prices;
  try {
    prices = JSON.parse(get('PADDLE_PRICE_IDS') || '{}');
  } catch {
    throw new BillingError('Billing catalogue is not configured', 503);
  }
  const seen = new Set();
  for (const tier of Object.keys(amounts))
    for (const period of Object.keys(periods)) {
      const id = prices[tier]?.[period];
      if (!/^pri_[a-z0-9]{26}$/.test(id || '') || seen.has(id))
        throw new BillingError('Billing catalogue is not configured', 503);
      seen.add(id);
    }
  if (!apiKey) throw new BillingError('Billing is not configured', 503);
  return {
    environment,
    apiKey,
    prices,
    base: environment === 'live' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com',
  };
}
export function validatePrice(price, tier, period) {
  const expected = approvedPrice(tier, period);
  const cycle = price?.billing_cycle;
  const trial = price?.trial_period;
  // The approved offer is free for exactly 30 days. Never inherit tax settings
  // from the account: the price displayed to the customer must include tax.
  const freeTrial =
    trial?.interval === 'day' &&
    trial.frequency === 30 &&
    (trial.unit_price == null ||
      (trial.unit_price.amount === '0' && trial.unit_price.currency_code === 'USD')) &&
    (trial.unit_price_overrides?.length ?? 0) === 0;
  const matchesCycle =
    (cycle?.interval === 'month' && cycle.frequency === expected.months) ||
    (expected.months === 12 && cycle?.interval === 'year' && cycle.frequency === 1);
  if (
    price?.status !== 'active' ||
    price?.unit_price?.currency_code !== 'USD' ||
    price.unit_price.amount !== expected.amount ||
    !matchesCycle ||
    !freeTrial ||
    price.tax_mode !== 'internal' ||
    (price.unit_price_overrides?.length ?? 0) > 0 ||
    price.quantity?.minimum !== 1 ||
    price.quantity?.maximum !== 1
  ) {
    throw new BillingError('This plan is not ready for purchase. Please contact support.', 503);
  }
}

/** Restrict returned checkout links to our configured payment page. */
export function checkoutPage(get) {
  try {
    const url = new URL(get('PADDLE_CHECKOUT_URL'));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error('Invalid checkout URL');
    return url;
  } catch {
    throw new BillingError('Checkout page is not configured', 503);
  }
}
export function checkoutResult(transaction, page, environment) {
  try {
    const url = new URL(transaction.checkout?.url);
    if (
      !/^txn_[a-z0-9]{26}$/.test(transaction.id || '') ||
      url.origin !== page.origin ||
      url.pathname !== page.pathname ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.get('_ptxn') !== transaction.id
    )
      throw new Error('Invalid checkout link');
    return { url: url.href, transactionId: transaction.id, environment };
  } catch {
    throw new BillingError('Checkout is awaiting configuration', 503);
  }
}
export function planForPrice(prices, id) {
  for (const tier of Object.keys(amounts))
    for (const period of Object.keys(periods)) {
      if (prices[tier]?.[period] === id) return { tier, period };
    }
  throw new BillingError('Unrecognised subscription price', 422);
}
export async function paddleRequest(config, path, options = {}, fetcher = fetch) {
  const response = await fetcher(`${config.base}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new BillingError('Billing provider is temporarily unavailable', 502);
  const json = await response.json();
  if (!json.data) throw new BillingError('Incomplete billing response', 502);
  return json.data;
}
export async function verifyPaddleSignature(raw, header, secret, now = Date.now()) {
  if (!secret || !header) return false;
  const fields = header.split(';').map((entry) => entry.trim().split('='));
  const stamps = fields.filter(([key]) => key === 'ts').map(([, value]) => value);
  if (stamps.length !== 1 || !/^\d+$/.test(stamps[0])) return false;
  if (Math.abs(now / 1000 - Number(stamps[0])) > 300) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  for (const [name, signature] of fields) {
    if (name !== 'h1' || !/^[a-f0-9]{64}$/i.test(signature || '')) continue;
    const bytes = Uint8Array.from(signature.match(/../g), (part) => parseInt(part, 16));
    if (
      await crypto.subtle.verify(
        'HMAC',
        key,
        bytes,
        new TextEncoder().encode(`${stamps[0]}:${raw}`)
      )
    )
      return true;
  }
  return false;
}
export function subscriptionEvent(event, config) {
  const types = new Set([
    'subscription.created',
    'subscription.updated',
    'subscription.activated',
    'subscription.canceled',
    'subscription.paused',
    'subscription.resumed',
    'subscription.past_due',
    'subscription.trialing',
  ]);
  if (!types.has(event.event_type)) return null;
  const data = event.data;
  if (
    !/^evt_[a-z0-9]{26}$/.test(event.event_id || '') ||
    !Number.isFinite(Date.parse(event.occurred_at)) ||
    !/^sub_[a-z0-9]{26}$/.test(data?.id || '') ||
    !/^ctm_[a-z0-9]{26}$/.test(data?.customer_id || '') ||
    data.collection_mode !== 'automatic' ||
    data.items?.length !== 1 ||
    data.items[0].quantity !== 1 ||
    !['active', 'trialing', 'past_due', 'paused', 'canceled'].includes(data.status)
  )
    throw new BillingError('Invalid subscription event', 422);
  const plan = planForPrice(config.prices, data.items[0].price?.id);
  const period = data.current_billing_period;
  if (
    period &&
    (!Number.isFinite(Date.parse(period.starts_at)) ||
      !Number.isFinite(Date.parse(period.ends_at)) ||
      Date.parse(period.ends_at) <= Date.parse(period.starts_at))
  )
    throw new BillingError('Invalid billing period', 422);
  if (['active', 'trialing', 'past_due'].includes(data.status) && !period)
    throw new BillingError('Missing billing period', 422);
  const cancelAt =
    data.scheduled_change?.action === 'cancel' ? data.scheduled_change.effective_at : null;
  if (cancelAt && !Number.isFinite(Date.parse(cancelAt)))
    throw new BillingError('Invalid cancellation date', 422);
  return {
    event_id: event.event_id,
    occurred_at: event.occurred_at,
    environment: config.environment,
    subscription_id: data.id,
    customer_id: data.customer_id,
    checkout_id: data.custom_data?.checkout_id ?? null,
    transaction_id: event.event_type === 'subscription.created' ? data.transaction_id : null,
    plan_tier: plan.tier,
    billing_period: plan.period,
    status: data.status,
    period_start: period?.starts_at ?? null,
    period_end: period?.ends_at ?? null,
    cancel_at: cancelAt,
    canceled_at: data.canceled_at ?? null,
  };
}
