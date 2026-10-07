process.env.EXPO_PUBLIC_PADDLE_ENV = 'sandbox';
jest.mock('../../src/services/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));
import { supabase } from '../../src/services/supabase';
import { PADDLE_PLAN_TIERS, getPaddlePrice } from '../../src/constants/paddlePlans';
const { validatePricePreview, previewPaddlePrices } = jest.requireActual<
  typeof import('../../src/services/paddlePricing')
>('../../src/services/paddlePricing');
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
