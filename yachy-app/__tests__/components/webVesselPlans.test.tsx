import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { VesselPlansScreen } from '../../src/screens/VesselPlansScreen.web';
import { PADDLE_PLAN_TIERS, getPaddlePrice } from '../../src/constants/paddlePlans';
let mockUser: any = { id: 'captain', role: 'CAPTAIN_MOV', vesselId: 'vessel' };
let mockWidth = 390;
let mockSubscription: any = null;
const mockRefetch = jest.fn();
const mockPreview = jest.fn();
const mockNavigate = jest.fn();
const mockStartTrial = jest.fn();
const mockPreparePayment = jest.fn();
const mockRecoverPayment = jest.fn();
const mockReactivate = jest.fn();
const mockManagementStatus = jest.fn();
const mockCancelRenewal = jest.fn();
const mockKeepSubscription = jest.fn();
const mockPaymentMethod = jest.fn();
let mockManagementEnabled = false;
let mockSandboxTrials = false;
let mockAccessState: string | null = null;
const mockFocusListeners = new Set<() => void>();
const originalAddEventListener = window.addEventListener;
const originalRemoveEventListener = window.removeEventListener;
const originalLocation = window.location;
beforeAll(() => {
  // The React Native Jest environment supplies window but no browser events.
  window.addEventListener = jest.fn((event: string, listener: any) => {
    if (event === 'focus') mockFocusListeners.add(listener);
  });
  window.removeEventListener = jest.fn((event: string, listener: any) => {
    if (event === 'focus') mockFocusListeners.delete(listener);
  });
});
afterAll(() => {
  window.addEventListener = originalAddEventListener;
  window.removeEventListener = originalRemoveEventListener;
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 844, scale: 1, fontScale: 1 }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('../../src/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({
    subscription: mockSubscription,
    accessState: mockAccessState ?? (mockSubscription ? 'entitled' : 'never_subscribed'),
    isLoading: false,
    refetch: mockRefetch,
  }),
}));
jest.mock('../../src/services/paddleBilling', () => ({
  paddleCheckoutEnabled: false,
  paddleEnvironment: 'sandbox',
  preparePaddleCheckout: jest.fn(),
  get paddleBillingEnabled() {
    return mockSandboxTrials;
  },
  get paddleManagementEnabled() {
    return mockManagementEnabled;
  },
  getPaddleManagementStatus: (...args: any[]) => mockManagementStatus(...args),
  cancelPaddleRenewal: (...args: any[]) => mockCancelRenewal(...args),
  keepPaddleSubscription: (...args: any[]) => mockKeepSubscription(...args),
  preparePaddlePaymentMethod: (...args: any[]) => mockPaymentMethod(...args),
  startPaddleTrial: (...args: any[]) => mockStartTrial(...args),
  preparePaddleTrialPayment: (...args: any[]) => mockPreparePayment(...args),
  preparePaddlePaymentRecovery: (...args: any[]) => mockRecoverPayment(...args),
  preparePaddleReactivation: (...args: any[]) => mockReactivate(...args),
}));
jest.mock('../../src/services/paddlePricing', () => ({
  previewPaddlePrices: (...args: any[]) => mockPreview(...args),
  usd: (n: number) => 'US$' + (n / 100).toFixed(2),
}));
jest.mock('../../src/store', () => ({
  useAuthStore: Object.assign((selector: any) => selector({ user: mockUser }), {
    getState: () => ({ user: mockUser }),
  }),
}));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    background: '#fff',
    surface: '#fff',
    textPrimary: '#111',
    textSecondary: '#444',
    accent: '#1E3A8A',
    border: '#ccc',
    controlSelected: '#123456',
    textOnAccent: '#fff',
  }),
}));
jest.mock('../../src/components', () => {
  const { Text, Pressable } = require('react-native');
  return {
    PageHeader: ({ title }: any) => <Text>{title}</Text>,
    Button: ({ title, disabled, onPress }: any) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
      >
        <Text>{title}</Text>
      </Pressable>
    ),
  };
});
jest.mock('../../src/components/BillingCountryPicker.web', () => {
  const { Text, Pressable } = require('react-native');
  return {
    billingCountryName: (code: string) => (code === 'FR' ? 'France' : 'Germany'),
    BillingCountryPicker: ({ visible, onConfirm }: any) =>
      visible ? (
        <>
          <Pressable onPress={() => onConfirm({ countryCode: 'FR', postalCode: '' })}>
            <Text>Choose France</Text>
          </Pressable>
          <Pressable onPress={() => onConfirm({ countryCode: 'DE', postalCode: '' })}>
            <Text>Choose Germany</Text>
          </Pressable>
        </>
      ) : null,
  };
});
function result(period = 'monthly', code = 'FR') {
  return {
    currency: 'USD',
    billingPeriod: period,
    countryCode: code,
    postalCode: '',
    quotes: PADDLE_PLAN_TIERS.map((t) => {
      const baseCents = getPaddlePrice(t.id, period as any).totalCents,
        taxCents = Math.round(baseCents * (code === 'FR' ? 0.2 : 0.19));
      return { tier: t.id, baseCents, taxCents, totalCents: baseCents + taxCents };
    }),
  };
}
beforeEach(() => {
  mockFocusListeners.clear();
  mockRefetch.mockReset();
  mockNavigate.mockReset();
  mockStartTrial.mockReset().mockResolvedValue(undefined);
  mockPreparePayment.mockReset();
  mockRecoverPayment.mockReset();
  mockReactivate.mockReset();
  mockManagementStatus.mockReset();
  mockCancelRenewal.mockReset();
  mockKeepSubscription.mockReset();
  mockPaymentMethod.mockReset();
  mockManagementEnabled = false;
  mockSandboxTrials = false;
  mockAccessState = null;
  mockUser = { id: 'captain', role: 'CAPTAIN_MOV', vesselId: 'vessel' };
  mockWidth = 390;
  mockSubscription = null;
  mockPreview
    .mockReset()
    .mockImplementation((_v, p, l) => Promise.resolve(result(p, l.countryCode)));
});
test('expired-trial payment stays on Vessel Plans on failure and cannot start another trial or unlock access', async () => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://example.test', assign: jest.fn() },
  });
  mockSubscription = {
    vesselId: 'vessel',
    status: 'canceled',
    paymentProvider: 'legacy_paddle',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2020-01-01',
  };
  mockAccessState = 'payment_required';
  mockSandboxTrials = true;
  mockReactivate.mockRejectedValue(new Error('Payment pending; refresh your plan.'));
  const screen = render(<VesselPlansScreen />);
  expect(screen.getByTestId('expired-trial-payment')).toBeTruthy();
  fireEvent.press(screen.getByText('Reactivate Subscription'));
  await waitFor(() => expect(screen.getByText('Payment pending; refresh your plan.')).toBeTruthy());
  expect(mockStartTrial).not.toHaveBeenCalled();
  expect(mockPreparePayment).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});
test('crew and active subscriptions cannot see the reactivation action', () => {
  mockSubscription = {
    vesselId: 'vessel',
    status: 'active',
    paymentProvider: 'legacy_paddle',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2099-01-01',
  };
  const screen = render(<VesselPlansScreen />);
  expect(screen.queryByText('Reactivate Subscription')).toBeNull();
  mockSubscription.status = 'canceled';
  mockAccessState = 'payment_required';
  mockUser = { ...mockUser, role: 'CREW' };
  screen.rerender(<VesselPlansScreen />);
  expect(screen.queryByText('Reactivate Subscription')).toBeNull();
});
test('expired trial waits for provider cancellation and refreshes without starting a second checkout', () => {
  mockSubscription = {
    vesselId: 'vessel',
    status: 'trialing',
    paymentProvider: 'legacy_paddle',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2020-01-01',
  };
  mockAccessState = 'payment_required';
  mockSandboxTrials = true;
  const screen = render(<VesselPlansScreen />);
  expect(screen.queryByText('Choose your vessel plan')).toBeNull();
  expect(screen.getByText(/Waiting for Paddle/)).toBeTruthy();
  fireEvent.press(screen.getByText('Reactivate Subscription'));
  expect(mockReactivate).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Refresh Plan Status'));
  expect(mockRefetch).toHaveBeenCalled();
});
test('prepared reactivation opens only checkout and never navigates directly to Home', async () => {
  const assign = jest.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://example.test', assign },
  });
  mockSubscription = {
    vesselId: 'vessel',
    status: 'canceled',
    paymentProvider: 'legacy_paddle',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2020-01-01',
  };
  mockAccessState = 'payment_required';
  mockSandboxTrials = true;
  const transaction = `txn_${'1'.repeat(26)}`;
  mockReactivate.mockResolvedValue(`https://example.test/checkout?_ptxn=${transaction}`);
  const screen = render(<VesselPlansScreen />);
  fireEvent.press(screen.getByText('Reactivate Subscription'));
  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith(`https://example.test/checkout?transaction=${transaction}`)
  );
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockStartTrial).not.toHaveBeenCalled();
});
test('management is opt-in and cancellation needs a provider date and explicit second confirmation', async () => {
  mockSubscription = {
    vesselId: 'vessel',
    status: 'active',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2030-03-01T00:00:00.000Z',
  };
  const screen = render(<VesselPlansScreen />);
  expect(screen.queryByText('Manage Subscription')).toBeNull();
  mockManagementEnabled = true;
  screen.rerender(<VesselPlansScreen />);
  mockManagementStatus.mockResolvedValue({
    status: 'active',
    periodEnd: '2030-03-01T00:00:00.000Z',
    cancellationScheduled: false,
  });
  fireEvent.press(screen.getByText('Manage Subscription'));
  await waitFor(() => expect(screen.getByText('Cancel Renewal')).toBeTruthy());
  expect(mockCancelRenewal).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Cancel Renewal'));
  expect(screen.getByText(/Any overdue payment remains due/)).toBeTruthy();
  expect(mockCancelRenewal).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Keep Subscription'));
  expect(screen.queryByText('Confirm Cancellation')).toBeNull();
  fireEvent.press(screen.getByText('Cancel Renewal'));
  mockCancelRenewal.mockResolvedValue(undefined);
  fireEvent.press(screen.getByText('Confirm Cancellation'));
  await waitFor(() => expect(screen.getByText(/Cancellation requested/)).toBeTruthy());
  expect(mockCancelRenewal).toHaveBeenCalledTimes(1);
  expect(mockCancelRenewal).toHaveBeenCalledWith('vessel', '2030-03-01T00:00:00.000Z');
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockStartTrial).not.toHaveBeenCalled();
});
test('confirmed cancellation replaces management with a persistent status and access-end date', () => {
  mockManagementEnabled = true;
  mockSubscription = {
    vesselId: 'vessel',
    status: 'canceled',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2030-03-01T08:40:00.000Z',
  };
  const screen = render(<VesselPlansScreen />);
  expect(screen.getByText('Renewal cancelled')).toBeTruthy();
  expect(screen.getByText(/Access ends .*2030/)).toBeTruthy();
  expect(screen.queryByText('Manage Subscription')).toBeNull();
  expect(screen.queryByText('Cancel Renewal')).toBeNull();
  expect(screen.queryByText('Update Payment Method')).toBeNull();
  expect(screen.getByText('Refresh Plan Status')).toBeTruthy();
  expect(mockManagementStatus).not.toHaveBeenCalled();
});
test('provider-confirmed scheduled cancellation replaces management before the webhook refresh', async () => {
  mockManagementEnabled = true;
  mockSubscription = {
    vesselId: 'vessel',
    status: 'active',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2030-03-01T08:40:00.000Z',
  };
  mockManagementStatus.mockResolvedValue({
    status: 'active',
    periodEnd: mockSubscription.currentPeriodEnd,
    cancellationScheduled: true,
  });
  const screen = render(<VesselPlansScreen />);
  fireEvent.press(screen.getByText('Manage Subscription'));
  await waitFor(() => expect(screen.getByText('Renewal cancelled')).toBeTruthy());
  expect(screen.queryByText('Manage Subscription')).toBeNull();
  expect(screen.queryByText('Cancel Renewal')).toBeNull();
  expect(mockCancelRenewal).not.toHaveBeenCalled();
});
test('expired cancelled subscriptions do not promise continuing access', () => {
  mockManagementEnabled = true;
  mockSubscription = {
    vesselId: 'vessel',
    status: 'canceled',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2020-03-01T08:40:00.000Z',
  };
  mockAccessState = 'payment_required';
  const screen = render(<VesselPlansScreen />);
  expect(screen.getByText(/Access ended .*2020/)).toBeTruthy();
  expect(screen.queryByText('Manage Subscription')).toBeNull();
  expect(screen.queryByText('Keep Subscription')).toBeNull();
});
test('keeping a cancelled renewal requires a fresh provider check and separate confirmation', async () => {
  mockManagementEnabled = true;
  mockSubscription = {
    vesselId: 'vessel',
    status: 'canceled',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2030-03-01T08:40:00.000Z',
  };
  mockManagementStatus.mockResolvedValue({
    status: 'active',
    periodEnd: mockSubscription.currentPeriodEnd,
    cancellationScheduled: true,
  });
  let complete: () => void = () => {};
  mockKeepSubscription.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      })
  );
  const screen = render(<VesselPlansScreen />);
  fireEvent.press(screen.getByText('Keep Subscription'));
  await waitFor(() => expect(screen.getByText('Confirm Renewal')).toBeTruthy());
  expect(mockKeepSubscription).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Leave Cancelled'));
  expect(screen.queryByText('Confirm Renewal')).toBeNull();
  expect(mockKeepSubscription).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Keep Subscription'));
  await waitFor(() => expect(screen.getByText('Confirm Renewal')).toBeTruthy());
  const confirm = screen.getByText('Confirm Renewal');
  fireEvent.press(confirm);
  fireEvent.press(confirm);
  expect(mockKeepSubscription).toHaveBeenCalledTimes(1);
  expect(mockKeepSubscription).toHaveBeenCalledWith('vessel', mockSubscription.currentPeriodEnd);
  await act(async () => complete());
  expect(screen.getByText(/Renewal restoration requested/)).toBeTruthy();
  // API success alone must not mark the database subscription active.
  expect(screen.getByText('Renewal cancelled')).toBeTruthy();
  expect(mockStartTrial).not.toHaveBeenCalled();
});
test('a failed keep request stays cancelled and requires another explicit attempt', async () => {
  mockManagementEnabled = true;
  mockSubscription = {
    vesselId: 'vessel',
    status: 'canceled',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2030-03-01T08:40:00.000Z',
  };
  mockManagementStatus.mockResolvedValue({
    status: 'active',
    periodEnd: mockSubscription.currentPeriodEnd,
    cancellationScheduled: true,
  });
  mockKeepSubscription.mockRejectedValue(new Error('timeout'));
  const screen = render(<VesselPlansScreen />);
  fireEvent.press(screen.getByText('Keep Subscription'));
  await waitFor(() => expect(screen.getByText('Confirm Renewal')).toBeTruthy());
  fireEvent.press(screen.getByText('Confirm Renewal'));
  await waitFor(() =>
    expect(screen.getByText(/Subscription action could not be confirmed/)).toBeTruthy()
  );
  expect(screen.queryByText('Confirm Renewal')).toBeNull();
  expect(screen.getByText('Renewal cancelled')).toBeTruthy();
  expect(mockKeepSubscription).toHaveBeenCalledTimes(1);
});
test.each(['CREW', 'HOD'])('%s cannot reinstate a cancelled renewal', (role) => {
  mockManagementEnabled = true;
  mockUser = { id: 'crew', role, vesselId: 'vessel' };
  mockSubscription = {
    vesselId: 'vessel',
    status: 'canceled',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2030-03-01T08:40:00.000Z',
  };
  const screen = render(<VesselPlansScreen />);
  expect(screen.queryByText('Keep Subscription')).toBeNull();
  expect(mockManagementStatus).not.toHaveBeenCalled();
  expect(mockKeepSubscription).not.toHaveBeenCalled();
});
test('management responses from a previous vessel cannot display or cancel its subscription', async () => {
  mockManagementEnabled = true;
  mockSubscription = {
    vesselId: 'vessel',
    status: 'active',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2030-03-01',
  };
  let resolve: (value: any) => void = () => {};
  mockManagementStatus.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const screen = render(<VesselPlansScreen />);
  fireEvent.press(screen.getByText('Manage Subscription'));
  mockUser = { id: 'other', role: 'CAPTAIN_MOV', vesselId: 'other-vessel' };
  screen.rerender(<VesselPlansScreen />);
  await act(async () =>
    resolve({ status: 'active', periodEnd: '2030-03-01', cancellationScheduled: false })
  );
  expect(screen.queryByText('Cancel Renewal')).toBeNull();
  expect(mockCancelRenewal).not.toHaveBeenCalled();
});
test('management failures do not automatically retry or claim cancellation succeeded', async () => {
  mockManagementEnabled = true;
  mockSubscription = {
    vesselId: 'vessel',
    status: 'active',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2030-03-01',
  };
  mockManagementStatus.mockRejectedValue(new Error('provider unavailable'));
  const screen = render(<VesselPlansScreen />);
  fireEvent.press(screen.getByText('Manage Subscription'));
  await waitFor(() =>
    expect(screen.getByText(/Subscription action could not be confirmed/)).toBeTruthy()
  );
  expect(mockManagementStatus).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Cancel Renewal')).toBeNull();
});
test('active payment-method updates use the existing branded checkout and suppress duplicate clicks', async () => {
  mockManagementEnabled = true;
  mockSubscription = {
    vesselId: 'vessel',
    status: 'active',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2030-03-01',
  };
  mockManagementStatus.mockResolvedValue({
    status: 'active',
    periodEnd: '2030-03-01',
    cancellationScheduled: false,
  });
  let complete: (url: string) => void = () => {};
  mockPaymentMethod.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const oldLocation = window.location;
  const assign = jest.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://nautical-ops.com', assign },
  });
  try {
    const screen = render(<VesselPlansScreen />);
    fireEvent.press(screen.getByText('Manage Subscription'));
    await waitFor(() => expect(screen.getByText('Update Payment Method')).toBeTruthy());
    fireEvent.press(screen.getByText('Update Payment Method'));
    fireEvent.press(screen.getByText('Update Payment Method'));
    expect(mockPaymentMethod).toHaveBeenCalledTimes(1);
    const transaction = 'txn_' + '1'.repeat(26);
    await act(async () => complete('https://nautical-ops.com/checkout?_ptxn=' + transaction));
    expect(assign).toHaveBeenCalledWith(
      'https://nautical-ops.com/checkout?transaction=' + transaction + '&flow=payment-method'
    );
    expect(mockStartTrial).not.toHaveBeenCalled();
    expect(mockCancelRenewal).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(window, 'location', { configurable: true, value: oldLocation });
  }
});
test('refreshes billing on browser focus and removes its listener on unmount', () => {
  const screen = render(<VesselPlansScreen />);
  mockRefetch.mockClear();
  act(() => mockFocusListeners.forEach((listener) => listener()));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
  screen.unmount();
  expect(mockFocusListeners.size).toBe(0);
});
const choose = (screen: any, name = 'France') => {
  fireEvent.press(screen.getByLabelText('Change billing country'));
  fireEvent.press(screen.getByText('Choose ' + name));
};
test('past-due recovery opens the existing payment once, without trial creation or local activation', async () => {
  mockSandboxTrials = true;
  mockAccessState = 'payment_required';
  mockSubscription = {
    vesselId: 'vessel',
    status: 'past_due',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2030-03-01',
  };
  let complete: (url: string) => void = () => {};
  mockRecoverPayment.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        complete = resolve;
      })
  );
  const oldLocation = window.location;
  const assign = jest.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://nautical-ops.com', assign },
  });
  try {
    const screen = render(<VesselPlansScreen />);
    fireEvent.press(screen.getByText('Resolve payment'));
    fireEvent.press(screen.getByText('Preparing…'));
    expect(mockRecoverPayment).toHaveBeenCalledTimes(1);
    const transaction = 'txn_' + '1'.repeat(26);
    await act(async () => complete(`https://nautical-ops.com/checkout?_ptxn=${transaction}`));
    expect(assign).toHaveBeenCalledWith(
      `https://nautical-ops.com/checkout?transaction=${transaction}`
    );
    expect(mockStartTrial).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(window, 'location', { configurable: true, value: oldLocation });
  }
});
test('recovery is disabled for unknown entitlement and wrong-vessel state; errors remain visible', async () => {
  mockSandboxTrials = true;
  mockAccessState = 'unavailable';
  mockSubscription = {
    vesselId: 'vessel',
    status: 'past_due',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: '2030-03-01',
  };
  const screen = render(<VesselPlansScreen />);
  fireEvent.press(screen.getByText('Resolve payment'));
  expect(mockRecoverPayment).not.toHaveBeenCalled();
  mockAccessState = 'payment_required';
  mockSubscription.vesselId = 'other';
  screen.rerender(<VesselPlansScreen />);
  fireEvent.press(screen.getByText('Resolve payment'));
  expect(mockRecoverPayment).not.toHaveBeenCalled();
  mockSubscription.vesselId = 'vessel';
  screen.rerender(<VesselPlansScreen />);
  const oldLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://nautical-ops.com' },
  });
  try {
    mockRecoverPayment.mockRejectedValue(new Error('Refresh Plan Status before retrying.'));
    fireEvent.press(screen.getByText('Resolve payment'));
    await waitFor(() =>
      expect(screen.getByText('Refresh Plan Status before retrying.')).toBeTruthy()
    );
  } finally {
    Object.defineProperty(window, 'location', { configurable: true, value: oldLocation });
  }
});
test.each(['CREW', 'HOD'])('payment recovery is never offered to %s', (role) => {
  mockUser.role = role;
  mockSandboxTrials = true;
  mockAccessState = 'payment_required';
  mockSubscription = { vesselId: 'vessel', status: 'past_due' };
  const screen = render(<VesselPlansScreen />);
  expect(screen.queryByText('Resolve payment')).toBeNull();
  expect(mockRecoverPayment).not.toHaveBeenCalled();
});
test('shows exact worldwide base totals before country selection, never as final tax-inclusive prices', () => {
  const screen = render(<VesselPlansScreen />);
  fireEvent.press(screen.getByText('Yearly'));
  expect(screen.getByText('US$1299.99 / year')).toBeTruthy();
  expect(screen.getByText('US$2699.99 / year')).toBeTruthy();
  expect(
    screen.getAllByText('Tax/VAT is calculated at checkout based on your billing region.')
  ).toHaveLength(1);
  expect(screen.queryByText(/^US\$.*before tax$/)).toBeNull();
  expect(screen.getByText('Awaiting tax total')).toBeTruthy();
  expect(screen.queryByText(/OFF|Apple|iPhone/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Continue' }).props.accessibilityState.disabled).toBe(
    true
  );
});
test('country preview displays tax-inclusive prices and the separate base/tax breakdown', async () => {
  const screen = render(<VesselPlansScreen />);
  choose(screen);
  await waitFor(() => expect(screen.getByText('US$95.99 / month')).toBeTruthy());
  expect(screen.queryByText('US$79.99 base + US$16.00 VAT / tax')).toBeNull();
  expect(screen.getByText('Subscription before tax')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText('Set up billing')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Payments not yet available' }).props.accessibilityState
      .disabled
  ).toBe(true);
  expect(screen.getByText(/business tax ID securely in Paddle/)).toBeTruthy();
});
test('failures show a retry action, not zero tax or an enabled checkout', async () => {
  mockPreview.mockRejectedValue(new Error('Tax unavailable'));
  const screen = render(<VesselPlansScreen />);
  choose(screen);
  await waitFor(() => expect(screen.getByText('Tax unavailable')).toBeTruthy());
  expect(screen.getByText('Not yet calculated')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Continue' }).props.accessibilityState.disabled).toBe(
    true
  );
  mockPreview.mockResolvedValue(result());
  fireEvent.press(screen.getByText('Retry Tax Calculation'));
  await waitFor(() => expect(screen.getByText('US$95.99 / month')).toBeTruthy());
});
test('out-of-order country responses cannot replace the latest tax totals', async () => {
  let resolveOld: any;
  mockPreview.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      })
  );
  const screen = render(<VesselPlansScreen />);
  choose(screen);
  choose(screen, 'Germany');
  await waitFor(() => expect(screen.getByText('US$95.19 / month')).toBeTruthy());
  await act(async () => resolveOld(result()));
  expect(screen.queryByText('US$95.99 / month')).toBeNull();
});
test('existing trial end is displayed without allowing a second subscription', async () => {
  mockSubscription = {
    status: 'trialing',
    planTier: '1_5',
    billingPeriod: 'monthly',
    currentPeriodEnd: new Date(Date.now() + 7 * 86400000).toISOString(),
  };
  const screen = render(<VesselPlansScreen />);
  choose(screen);
  await waitFor(() => expect(screen.getByText('US$95.99 / month')).toBeTruthy());
  fireEvent.press(screen.getByText('Continue'));
  expect(screen.getByText(/do not start a second subscription/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Payments not yet available' }).props.accessibilityState
      .disabled
  ).toBe(true);
});
test.each([320, 390, 768, 820, 1024, 1366, 1440])('layout adapts at %s pixels', (width) => {
  mockWidth = width;
  const screen = render(<VesselPlansScreen />);
  expect(StyleSheet.flatten(screen.getByTestId('billing-layout').props.style).flexDirection).toBe(
    width >= 1000 ? 'row' : undefined
  );
  expect(screen.getByTestId('billing-summary')).toBeTruthy();
});
test('crew cannot view billing controls or trigger preview requests', () => {
  mockUser = { role: 'CREW', vesselId: 'vessel' };
  const screen = render(<VesselPlansScreen />);
  expect(screen.getByText(/Only the vessel/)).toBeTruthy();
  expect(screen.queryByText('Yearly')).toBeNull();
  expect(mockPreview).not.toHaveBeenCalled();
});

const trial = () => ({
  vesselId: 'vessel',
  status: 'trialing',
  planTier: '6_10',
  billingPeriod: 'monthly',
  currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
});
test('optional billing appears only after server confirmation; skip goes Home without payment setup', async () => {
  mockSandboxTrials = true;
  const screen = render(<VesselPlansScreen />);
  choose(screen);
  await waitFor(() => expect(screen.getByText('US$95.99 / month')).toBeTruthy());
  fireEvent.press(screen.getByText('Continue'));
  fireEvent.press(screen.getByText('Start 30-day free trial'));
  await waitFor(() => expect(screen.getByText('Awaiting trial confirmation')).toBeTruthy());
  expect(screen.queryByTestId('optional-trial-billing')).toBeNull();
  expect(mockStartTrial).toHaveBeenCalledTimes(1);
  mockSubscription = trial();
  screen.rerender(<VesselPlansScreen />);
  await waitFor(() => expect(screen.getByText('Your 30-day free trial is ready')).toBeTruthy());
  expect(screen.getByText('US$107.99 / month')).toBeTruthy();
  expect(screen.getByText('Due today: US$0.00')).toBeTruthy();
  fireEvent.press(screen.getByText('Continue without payment details'));
  expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'Home' });
  expect(mockPreparePayment).not.toHaveBeenCalled();
  expect(mockStartTrial).toHaveBeenCalledTimes(1);
});

test('existing trial opens the same optional step and payment errors stay beside its action', async () => {
  mockSandboxTrials = true;
  mockSubscription = trial();
  mockPreparePayment.mockRejectedValue(new Error('Payment setup could not be confirmed.'));
  const originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://nautical-ops.com', assign: jest.fn() },
  });
  try {
    const screen = render(<VesselPlansScreen />);
    choose(screen);
    await waitFor(() => expect(screen.getByText('US$95.99 / month')).toBeTruthy());
    fireEvent.press(screen.getByText('Set up new billing details'));
    expect(screen.getByText('Set up your billing details')).toBeTruthy();
    expect(screen.getByText('US$107.99 / month')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Promo code (optional)'), 'VQ72100');
    fireEvent.press(screen.getByText('Set up billing details'));
    await waitFor(() =>
      expect(screen.getByText('Payment setup could not be confirmed.')).toBeTruthy()
    );
    expect(mockPreparePayment).toHaveBeenCalledWith(
      'vessel',
      'https://nautical-ops.com',
      mockSubscription.currentPeriodEnd,
      'VQ72100'
    );
    expect(mockStartTrial).not.toHaveBeenCalled();
    expect(window.location.assign).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  }
});

test('payment setup opens only the existing trial transaction and double taps do not duplicate it', async () => {
  mockSandboxTrials = true;
  mockSubscription = trial();
  let resolvePayment: (value: string) => void = () => {};
  mockPreparePayment.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolvePayment = resolve;
      })
  );
  const originalLocation = window.location;
  const assign = jest.fn();
  const originalStorage = window.sessionStorage;
  const setItem = jest.fn();
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: { setItem } });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://nautical-ops.com', assign },
  });
  try {
    const screen = render(<VesselPlansScreen />);
    choose(screen);
    await waitFor(() => expect(screen.getByText('US$95.99 / month')).toBeTruthy());
    fireEvent.press(screen.getByText('Set up new billing details'));
    fireEvent.press(screen.getByText('Set up billing details'));
    fireEvent.press(screen.getByText('Preparing secure checkout…'));
    expect(mockPreparePayment).toHaveBeenCalledTimes(1);
    const transaction = 'txn_' + '1'.repeat(26);
    await act(async () => resolvePayment('https://nautical-ops.com/checkout?_ptxn=' + transaction));
    expect(assign).toHaveBeenCalledWith(
      'https://nautical-ops.com/checkout?transaction=' + transaction + '&flow=payment-method'
    );
    expect(mockStartTrial).not.toHaveBeenCalled();
    const [key, value] = setItem.mock.calls[0];
    expect(key).toBe('paddle-trial-summary:' + transaction);
    expect(JSON.parse(value)).toEqual({
      trialEnd: mockSubscription.currentPeriodEnd,
      savedAt: expect.any(Number),
    });
  } finally {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: originalStorage });
  }
});

test.each([320, 390, 768, 820, 1024, 1366, 1440])(
  'optional billing fits its parent at %s pixels',
  (width) => {
    mockWidth = width;
    mockSandboxTrials = true;
    mockSubscription = trial();
    const screen = render(<VesselPlansScreen />);
    fireEvent.press(screen.getByText('Set up new billing details'));
    const style = StyleSheet.flatten(screen.getByTestId('optional-trial-billing').props.style);
    expect(style.width).toBe('100%');
    expect(style.maxWidth).toBe(720);
    expect(
      screen.getByRole('button', { name: 'Set up billing details' }).props.accessibilityState
        .disabled
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Continue without payment details' }).props
        .accessibilityState.disabled
    ).toBe(false);
  }
);

test('an unavailable, expired or different-vessel trial cannot open payment setup', () => {
  mockSandboxTrials = true;
  mockSubscription = trial();
  mockAccessState = 'unavailable';
  const screen = render(<VesselPlansScreen />);
  fireEvent.press(screen.getByText('Set up new billing details'));
  expect(screen.queryByTestId('optional-trial-billing')).toBeNull();
  mockAccessState = 'entitled';
  mockSubscription.vesselId = 'other-vessel';
  screen.rerender(<VesselPlansScreen />);
  fireEvent.press(screen.getByText('Set up new billing details'));
  expect(screen.queryByTestId('optional-trial-billing')).toBeNull();
  mockSubscription = {
    ...trial(),
    currentPeriodEnd: new Date(Date.now() - 86400000).toISOString(),
  };
  screen.rerender(<VesselPlansScreen />);
  expect(screen.queryByText('Set up new billing details')).toBeNull();
  expect(mockPreparePayment).not.toHaveBeenCalled();
});
