process.env.EXPO_PUBLIC_PADDLE_CHECKOUT_ENABLED = 'true';
process.env.EXPO_PUBLIC_PADDLE_ENV = 'sandbox';
jest.mock('../../src/services/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));
import { supabase } from '../../src/services/supabase';
type BillingModule = typeof import('../../src/services/paddleBilling');
// Load after environment setup; static imports are hoisted by this Jest preset.
const { preparePaddleCheckout, validatedCheckoutUrl } = jest.requireActual<BillingModule>(
  '../../src/services/paddleBilling'
);

const transactionId = `txn_${'1'.repeat(26)}`;
const response = {
  environment: 'sandbox',
  transactionId,
  url: `https://www.nautical-ops.com/checkout?_ptxn=${transactionId}`,
};
const invoke = supabase.functions.invoke as jest.Mock;
beforeEach(() => jest.clearAllMocks());
test('accepts only a same-origin checkout for the correct transaction and environment', () => {
  expect(validatedCheckoutUrl(response, 'https://www.nautical-ops.com')).toBe(response.url);
  for (const patch of [
    { environment: 'live' },
    { transactionId: 'bad' },
    { url: 'https://evil.example/checkout' },
    { url: `https://www.nautical-ops.com/login?_ptxn=${transactionId}` },
    { url: `https://www.nautical-ops.com/checkout?_ptxn=txn_${'2'.repeat(26)}` },
  ])
    expect(() =>
      validatedCheckoutUrl({ ...response, ...patch }, 'https://www.nautical-ops.com')
    ).toThrow();
});
test('sends plan identity, never a client-supplied amount or price ID', async () => {
  invoke.mockResolvedValue({ data: response, error: null });
  await expect(
    preparePaddleCheckout('vessel', '1_5', 'monthly', 'https://www.nautical-ops.com')
  ).resolves.toBe(response.url);
  expect(invoke).toHaveBeenCalledWith('create-paddle-checkout', {
    body: { vesselId: 'vessel', planTier: '1_5', billingPeriod: 'monthly' },
  });
});
test('ambiguous requests are not automatically retried', async () => {
  invoke.mockResolvedValue({ data: null, error: new Error('timeout') });
  await expect(
    preparePaddleCheckout('vessel', '1_5', 'monthly', 'https://www.nautical-ops.com')
  ).rejects.toThrow(/could not be confirmed/);
  expect(invoke).toHaveBeenCalledTimes(1);
});
