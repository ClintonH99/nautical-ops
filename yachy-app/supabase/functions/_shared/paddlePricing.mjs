import {
  BillingError,
  approvedPrice,
  paddleConfig,
  paddleRequest,
  validatePrice,
} from './paddle.mjs';

const tiers = ['1_5', '6_10', '11_15', '16_25', '26_40', '40_plus'];
export function billingLocation(value) {
  if (!value || typeof value.countryCode !== 'string' || !/^[A-Z]{2}$/.test(value.countryCode))
    throw new BillingError('Choose your billing country.');
  const postalCode = typeof value.postalCode === 'string' ? value.postalCode.trim() : '';
  if (postalCode.length > 32 || /[\u0000-\u001f]/.test(postalCode))
    throw new BillingError('Enter a valid ZIP or postal code.');
  // Keep aligned with BillingCountryPicker and Paddle's supported-countries list.
  if (
    ['AU', 'CA', 'DE', 'ES', 'FR', 'GB', 'IN', 'IT', 'NL', 'US'].includes(value.countryCode) &&
    !postalCode
  )
    throw new BillingError('Enter your billing ZIP or postal code for local tax.');
  return { country_code: value.countryCode, ...(postalCode ? { postal_code: postalCode } : {}) };
}

// Read-only preview. No transactions, entitlements, addresses or businesses are created.
export async function previewPaddlePrices(config, period, address, fetcher = fetch) {
  const data = await paddleRequest(
    config,
    '/pricing-preview',
    {
      method: 'POST',
      body: JSON.stringify({
        currency_code: 'USD',
        address,
        items: tiers.map((tier) => ({ price_id: config.prices[tier][period], quantity: 1 })),
      }),
    },
    fetcher
  );
  if (data.currency_code !== 'USD' || data.details?.line_items?.length !== tiers.length)
    throw new BillingError('Tax totals could not be verified. Please try again.', 502);
  return tiers.map((tier) => {
    const matches = data.details.line_items.filter(
      (line) => line.price?.id === config.prices[tier][period]
    );
    if (matches.length !== 1) throw new BillingError('Incomplete price preview', 502);
    const line = matches[0];
    validatePrice(line.price, tier, period);
    const t = line.totals;
    if (
      line.quantity !== 1 ||
      !t ||
      !['subtotal', 'tax', 'total', 'discount'].every(
        (key) =>
          typeof t[key] === 'string' && /^\d+$/.test(t[key]) && Number.isSafeInteger(Number(t[key]))
      ) ||
      t.subtotal !== approvedPrice(tier, period).amount ||
      Number(t.discount) !== 0 ||
      Number(t.total) !== Number(t.subtotal) + Number(t.tax)
    )
      throw new BillingError('Price preview does not match the approved plan', 502);
    return {
      tier,
      baseCents: Number(t.subtotal),
      taxCents: Number(t.tax),
      totalCents: Number(t.total),
    };
  });
}

export function createPaddlePricingHandler({ getEnv, createClient, fetcher = fetch }) {
  return async (request) => {
    if (request.method !== 'POST')
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    try {
      if (getEnv('PADDLE_PRICE_PREVIEW_ENABLED') !== 'true')
        throw new BillingError(
          'Regional tax previews are being configured. No payment can be taken.',
          503
        );
      const authorization = request.headers.get('authorization');
      if (!authorization?.startsWith('Bearer ')) throw new BillingError('Sign in to continue', 401);
      const client = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: authorization } },
      });
      const { data: auth, error: authError } = await client.auth.getUser();
      if (authError || !auth.user) throw new BillingError('Sign in to continue', 401);
      const body = await request.json();
      const { data: user, error } = await client
        .from('users')
        .select('role,vessel_id')
        .eq('id', auth.user.id)
        .single();
      if (
        error ||
        user?.role !== 'CAPTAIN_MOV' ||
        !user.vessel_id ||
        user.vessel_id !== body.vesselId
      )
        throw new BillingError('Only the vessel Captain/MOV can preview its billing.', 403);
      approvedPrice('1_5', body.billingPeriod);
      const address = billingLocation(body);
      const config = paddleConfig(getEnv);
      const quotes = await previewPaddlePrices(config, body.billingPeriod, address, fetcher);
      return Response.json(
        {
          environment: config.environment,
          currency: 'USD',
          billingPeriod: body.billingPeriod,
          countryCode: address.country_code,
          postalCode: address.postal_code ?? '',
          quotes,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof BillingError
              ? error.message
              : 'Tax preview is temporarily unavailable. Try again.',
        },
        { status: error instanceof BillingError ? error.status : 503 }
      );
    }
  };
}
