process.env.EXPO_PUBLIC_PADDLE_CHECKOUT_ENABLED = 'true';
process.env.EXPO_PUBLIC_PADDLE_ENV = 'sandbox';
process.env.EXPO_PUBLIC_PADDLE_SANDBOX_TRIAL_ENABLED = 'true';
process.env.EXPO_PUBLIC_PADDLE_SUBSCRIPTION_MANAGEMENT_ENABLED = 'true';
jest.mock('../../src/services/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));
import { supabase } from '../../src/services/supabase';
type BillingModule = typeof import('../../src/services/paddleBilling');
// Load after environment setup; static imports are hoisted by this Jest preset.
const {
  preparePaddleCheckout,
  validatedCheckoutUrl,
  startPaddleTrial,
  preparePaddleTrialPayment,
  preparePaddlePaymentRecovery,
  preparePaddleReactivation,
  getPaddleManagementStatus,
  cancelPaddleRenewal,
  keepPaddleSubscription,
  preparePaddlePaymentMethod,
} = jest.requireActual<BillingModule>('../../src/services/paddleBilling');

const transactionId = `txn_${'1'.repeat(26)}`;
const response = {
  environment: 'sandbox',
  transactionId,
  url: `https://www.nautical-ops.com/checkout?_ptxn=${transactionId}`,
};
const invoke = supabase.functions.invoke as jest.Mock;
beforeEach(() => jest.clearAllMocks());
test('trial payment sends optional promo only to the authenticated server flow', async () => {
  const trialEnd = '2030-02-01T00:00:00.000Z';
  invoke.mockResolvedValue({ data: { ...response, purpose: 'trial_payment_method', trialEnd } });
  await preparePaddleTrialPayment('vessel', 'https://www.nautical-ops.com', trialEnd, ' VQ72100 ');
  expect(invoke).toHaveBeenCalledWith('prepare-paddle-trial-payment', {
    body: { vesselId: 'vessel', promoCode: 'VQ72100' },
  });
});
test('reactivation sends no client prices or subscription IDs and rejects wrong-purpose or hostile checkout responses', async () => {
  invoke.mockResolvedValue({ data: { ...response, purpose: 'paid_reactivation' } });
  await expect(preparePaddleReactivation('vessel', 'https://www.nautical-ops.com')).resolves.toBe(
    response.url
  );
  expect(invoke).toHaveBeenCalledWith('prepare-paddle-reactivation', {
    body: { vesselId: 'vessel' },
  });
  for (const patch of [
    { purpose: 'trial_payment_method' },
    { environment: 'live' },
    { url: 'https://evil.example/checkout' },
  ]) {
    invoke.mockResolvedValue({ data: { ...response, purpose: 'paid_reactivation', ...patch } });
    await expect(
      preparePaddleReactivation('vessel', 'https://www.nautical-ops.com')
    ).rejects.toThrow();
  }
});
test('keeping a subscription requires an environment-matched confirmation of the same renewal date', async () => {
  const periodEnd = '2030-03-01T00:00:00.000Z';
  invoke.mockResolvedValue({
    data: { environment: 'sandbox', state: 'pending_confirmation', periodEnd },
  });
  await keepPaddleSubscription('vessel', periodEnd);
  expect(invoke).toHaveBeenLastCalledWith('manage-paddle-subscription', {
    body: { vesselId: 'vessel', action: 'keep_subscription', confirm: true, periodEnd },
  });
  for (const data of [
    { environment: 'live', state: 'pending_confirmation', periodEnd },
    { environment: 'sandbox', state: 'active', periodEnd },
    { environment: 'sandbox', state: 'pending_confirmation', periodEnd: '2031-01-01' },
  ]) {
    invoke.mockResolvedValue({ data });
    await expect(keepPaddleSubscription('vessel', periodEnd)).rejects.toThrow();
  }
});
test('management only sends vessel and confirmed date, and does not accept unverified responses', async () => {
  const periodEnd = '2030-03-01T00:00:00.000Z';
  invoke.mockResolvedValue({
    data: { environment: 'sandbox', status: 'active', periodEnd, cancellationScheduled: false },
  });
  await expect(getPaddleManagementStatus('vessel')).resolves.toMatchObject({ periodEnd });
  expect(invoke).toHaveBeenLastCalledWith('manage-paddle-subscription', {
    body: { vesselId: 'vessel', action: 'status' },
  });
  invoke.mockResolvedValue({
    data: { environment: 'sandbox', state: 'pending_confirmation', periodEnd },
  });
  await cancelPaddleRenewal('vessel', periodEnd);
  expect(invoke).toHaveBeenLastCalledWith('manage-paddle-subscription', {
    body: { vesselId: 'vessel', action: 'cancel_renewal', confirm: true, periodEnd },
  });
  invoke.mockResolvedValue({ data: { ...response, purpose: 'payment_method' } });
  await expect(preparePaddlePaymentMethod('vessel', 'https://www.nautical-ops.com')).resolves.toBe(
    response.url
  );
  invoke.mockResolvedValue({ data: { ...response, purpose: 'payment_recovery' } });
  await expect(
    preparePaddlePaymentMethod('vessel', 'https://www.nautical-ops.com')
  ).rejects.toThrow();
  invoke.mockResolvedValue({
    data: { environment: 'live', state: 'pending_confirmation', periodEnd },
  });
  await expect(cancelPaddleRenewal('vessel', periodEnd)).rejects.toThrow();
});
test('live billing and management default off even with the old checkout flag', async () => {
  process.env.EXPO_PUBLIC_PADDLE_ENV = 'live';
  delete process.env.EXPO_PUBLIC_PADDLE_LIVE_BILLING_ENABLED;
  try {
    jest.isolateModules(() => {
      const live = jest.requireActual<BillingModule>('../../src/services/paddleBilling');
      expect(live.paddleBillingEnabled).toBe(false);
      expect(live.paddleCheckoutEnabled).toBe(false);
      expect(live.paddleManagementEnabled).toBe(false);
    });
    process.env.EXPO_PUBLIC_PADDLE_LIVE_BILLING_ENABLED = 'true';
    jest.isolateModules(() => {
      const live = jest.requireActual<BillingModule>('../../src/services/paddleBilling');
      expect(live.paddleBillingEnabled).toBe(true);
      expect(live.paddleManagementEnabled).toBe(true);
    });
  } finally {
    process.env.EXPO_PUBLIC_PADDLE_ENV = 'sandbox';
    delete process.env.EXPO_PUBLIC_PADDLE_LIVE_BILLING_ENABLED;
  }
});
test('payment recovery sends only vessel identity and requires a verified sandbox recovery transaction', async () => {
  invoke.mockResolvedValue({ data: { ...response, purpose: 'payment_recovery' }, error: null });
  await expect(
    preparePaddlePaymentRecovery('vessel', 'https://www.nautical-ops.com')
  ).resolves.toBe(response.url);
  expect(invoke).toHaveBeenCalledWith('prepare-paddle-payment-recovery', {
    body: { vesselId: 'vessel' },
  });
  for (const patch of [
    { purpose: 'trial_payment_method' },
    { environment: 'live' },
    { url: 'https://evil.example/checkout' },
  ]) {
    invoke.mockResolvedValue({
      data: { ...response, purpose: 'payment_recovery', ...patch },
      error: null,
    });
    await expect(
      preparePaddlePaymentRecovery('vessel', 'https://www.nautical-ops.com')
    ).rejects.toThrow();
  }
  invoke.mockResolvedValue({ data: null, error: { message: 'private diagnostics' } });
  await expect(
    preparePaddlePaymentRecovery('vessel', 'https://www.nautical-ops.com')
  ).rejects.toThrow(/Refresh Plan Status/);
});
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
