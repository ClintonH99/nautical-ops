process.env.EXPO_PUBLIC_PADDLE_ENV = 'sandbox';
jest.mock('../../src/services/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));
import { supabase } from '../../src/services/supabase';
import { PADDLE_PLAN_TIERS, getPaddlePrice } from '../../src/constants/paddlePlans';
const { validatePricePreview, previewPaddlePrices, validatePromoPreview, previewPaddlePromo } =
  jest.requireActual<typeof import('../../src/services/paddlePricing')>(
    '../../src/services/paddlePricing'
  );
const location = { countryCode: 'FR', postalCode: '' };
const fixture = () => ({
  environment: 'sandbox',
  currency: 'USD',
  billingPeriod: 'monthly',
  ...location,
  quotes: PADDLE_PLAN_TIERS.map((t) => {
    const baseCents = getPaddlePrice(t.id, 'monthly').totalCents;
    const taxCents = Math.round(baseCents * 0.2);
    return { tier: t.id, baseCents, taxCents, totalCents: baseCents + taxCents };
  }),
});
test('verifies every tier and binds quotes to environment, billing period and location', () => {
  expect(validatePricePreview(fixture(), 'monthly', location).quotes[0].totalCents).toBe(9599);
  for (const patch of [
    { environment: 'live' },
    { countryCode: 'DE' },
    { postalCode: '123' },
    { currency: 'EUR' },
    { billingPeriod: '12_months' },
    { quotes: [] },
  ])
    expect(() => validatePricePreview({ ...fixture(), ...patch }, 'monthly', location)).toThrow();
  const d = fixture();
  d.quotes[0].taxCents = 0;
  expect(() => validatePricePreview(d, 'monthly', location)).toThrow();
});
test('never sends prices or tax rates supplied by the browser', async () => {
  (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: fixture() });
  await previewPaddlePrices('vessel', 'monthly', location);
  expect(supabase.functions.invoke).toHaveBeenCalledWith('preview-paddle-prices', {
    body: { vesselId: 'vessel', billingPeriod: 'monthly', ...location },
  });
});
test('a provider failure cannot become a zero-tax quote', async () => {
  (supabase.functions.invoke as jest.Mock).mockResolvedValue({ error: new Error('offline') });
  await expect(previewPaddlePrices('vessel', 'monthly', location)).rejects.toThrow(/unavailable/);
});

const promoFixture = () => ({
  environment: 'sandbox',
  currency: 'USD',
  billingPeriod: 'monthly',
  ...location,
  trialEnd: new Date(Date.now() + 86400000).toISOString(),
  expiresAt: new Date(Date.now() + 240000).toISOString(),
  promo: { code: 'DEMO25', recur: false, maximumRecurringIntervals: null },
  quote: { tier: '1_5', baseCents: 7999, discountCents: 2000, taxCents: 900, totalCents: 6899 },
});
test('discount preview binds the code, plan, address, trial and currency; zero total can be valid', () => {
  const data = promoFixture();
  const check = (d: any) =>
    validatePromoPreview(d, '1_5', 'monthly', location, 'DEMO25', data.trialEnd);
  expect(check(data).quote.totalCents).toBe(6899);
  expect(
    check({ ...data, quote: { ...data.quote, discountCents: 7999, taxCents: 0, totalCents: 0 } })
      .quote.totalCents
  ).toBe(0);
  for (const patch of [
    { environment: 'live' },
    { countryCode: 'US' },
    { currency: 'EUR' },
    { postalCode: 'different' },
    { billingPeriod: '3_months' },
    { trialEnd: 'invalid' },
    { expiresAt: new Date(Date.now() - 1).toISOString() },
    { promo: { ...data.promo, code: 'OTHER' } },
    { quote: { ...data.quote, tier: '6_10' } },
    { quote: { ...data.quote, taxCents: 0 } },
    { quote: { ...data.quote, totalCents: -1 } },
  ])
    expect(() => check({ ...data, ...patch })).toThrow();
});
test('promo service sends only selected context and code, never a browser discount amount', async () => {
  const data = promoFixture();
  (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data });
  await previewPaddlePromo('vessel', '1_5', 'monthly', location, ' DEMO25 ', data.trialEnd);
  expect(supabase.functions.invoke).toHaveBeenLastCalledWith('preview-paddle-prices', {
    body: {
      vesselId: 'vessel',
      tier: '1_5',
      billingPeriod: 'monthly',
      ...location,
      promoCode: 'DEMO25',
      trialEnd: data.trialEnd,
    },
  });
});
