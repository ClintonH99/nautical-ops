process.env.EXPO_PUBLIC_PADDLE_CHECKOUT_ENABLED = 'true';
process.env.EXPO_PUBLIC_PADDLE_ENV = 'sandbox';
process.env.EXPO_PUBLIC_PADDLE_SANDBOX_TRIAL_ENABLED = 'true';
jest.mock('../../src/services/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));
import { supabase } from '../../src/services/supabase';
type BillingModule = typeof import('../../src/services/paddleBilling');
// Load after environment setup; static imports are hoisted by this Jest preset.
const { preparePaddleCheckout, validatedCheckoutUrl, startPaddleTrial, preparePaddleTrialPayment } =
  jest.requireActual<BillingModule>('../../src/services/paddleBilling');

const transactionId = `txn_${'1'.repeat(26)}`;
const response = {
  environment: 'sandbox',
  transactionId,
  url: `https://www.nautical-ops.com/checkout?_ptxn=${transactionId}`,
};
const invoke = supabase.functions.invoke as jest.Mock;
beforeEach(() => jest.clearAllMocks());
test('explains an unapproved sandbox account without exposing arbitrary server errors', async () => {
  const failure = (status: number, error: string) => ({
    data: null,
    error: { context: { status, clone: () => ({ json: async () => ({ error }) }) } },
  });
  invoke.mockResolvedValue(failure(403, 'Sandbox testing is restricted.'));
  await expect(
    startPaddleTrial('vessel', '1_5', 'monthly', { countryCode: 'US', postalCode: '33316' })
  ).rejects.toThrow(/not authorised for sandbox/);
  invoke.mockResolvedValue(failure(503, 'private provider diagnostic'));
  await expect(
    startPaddleTrial('vessel', '1_5', 'monthly', { countryCode: 'US', postalCode: '33316' })
  ).rejects.toThrow(/could not be confirmed/);
});
test('distinguishes expired sessions and blocked reservations without retrying', async () => {
  for (const [status, expected] of [
    [401, /Sign in again/],
    [409, /Refresh Plan Status/],
  ] as const) {
    invoke.mockResolvedValue({
      data: null,
      error: { context: { status, clone: () => ({ json: async () => ({}) }) } },
    });
    await expect(
      startPaddleTrial('vessel', '1_5', 'monthly', { countryCode: 'US', postalCode: '33316' })
    ).rejects.toThrow(expected);
  }
  expect(invoke).toHaveBeenCalledTimes(2);
});
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
test('canonical sandbox links stay on the current website or preview without changing the transaction', () => {
  const canonical = {
    ...response,
    url: `https://nautical-ops.vercel.app/checkout?_ptxn=${transactionId}`,
  };
  for (const origin of [
    'https://nautical-ops.com',
    'https://www.nautical-ops.com',
    'https://nautical-preview-clintonh99s-projects.vercel.app',
  ]) {
    expect(validatedCheckoutUrl(canonical, origin)).toBe(
      `${origin}/checkout?_ptxn=${transactionId}`
    );
  }
  for (const url of [
    `https://nautical-ops.vercel.app.evil.example/checkout?_ptxn=${transactionId}`,
    `https://nautical-ops.vercel.app/checkout?_ptxn=${transactionId}&_ptxn=${transactionId}`,
    `https://nautical-ops.vercel.app/checkout?_ptxn=${transactionId}&redirect=https://evil.example`,
    `https://user:password@nautical-ops.vercel.app/checkout?_ptxn=${transactionId}`,
    `https://nautical-ops.vercel.app/checkout?_ptxn=${transactionId}#fragment`,
  ])
    expect(() => validatedCheckoutUrl({ ...response, url }, 'https://nautical-ops.com')).toThrow();
  expect(() => validatedCheckoutUrl(canonical, 'http://nautical-ops.com')).toThrow();
  expect(() => validatedCheckoutUrl(canonical, 'https://nautical-ops.com/path')).toThrow();
});
test('live checkout cannot use the sandbox canonical-origin exception', () => {
  process.env.EXPO_PUBLIC_PADDLE_ENV = 'live';
  try {
    jest.isolateModules(() => {
      const live = jest.requireActual<BillingModule>('../../src/services/paddleBilling');
      expect(() =>
        live.validatedCheckoutUrl(
          {
            ...response,
            environment: 'live',
            url: `https://nautical-ops.vercel.app/checkout?_ptxn=${transactionId}`,
          },
          'https://nautical-ops.com'
        )
      ).toThrow();
    });
  } finally {
    process.env.EXPO_PUBLIC_PADDLE_ENV = 'sandbox';
  }
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
test('cardless trial sends plan and billing country without card or client amounts', async () => {
  invoke.mockResolvedValue({
    data: { environment: 'sandbox', state: 'pending_confirmation' },
    error: null,
  });
  await startPaddleTrial('vessel', '1_5', 'monthly', { countryCode: 'FR', postalCode: '' });
  expect(invoke).toHaveBeenCalledWith('start-paddle-trial', {
    body: {
      vesselId: 'vessel',
      planTier: '1_5',
      billingPeriod: 'monthly',
      countryCode: 'FR',
      postalCode: '',
    },
  });
});
test('card setup requires the same trial end and does not send a new plan', async () => {
  const trialEnd = '2030-02-01T00:00:00Z';
  invoke.mockResolvedValue({
    data: { ...response, purpose: 'trial_payment_method', trialEnd },
    error: null,
  });
  await expect(
    preparePaddleTrialPayment('vessel', 'https://www.nautical-ops.com', trialEnd)
  ).resolves.toBe(response.url);
  expect(invoke).toHaveBeenCalledWith('prepare-paddle-trial-payment', {
    body: { vesselId: 'vessel' },
  });
  invoke.mockResolvedValue({
    data: { ...response, purpose: 'trial_payment_method', trialEnd: '2030-03-01T00:00:00Z' },
    error: null,
  });
  await expect(
    preparePaddleTrialPayment('vessel', 'https://www.nautical-ops.com', trialEnd)
  ).rejects.toThrow(/could not be confirmed/);
});
