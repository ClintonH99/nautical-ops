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
let mockSandboxTrials = false;
let mockAccessState: string | null = null;
const mockFocusListeners = new Set<() => void>();
const originalAddEventListener = window.addEventListener;
const originalRemoveEventListener = window.removeEventListener;
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
  get paddleSandboxTrialsEnabled() {
    return mockSandboxTrials;
  },
  startPaddleTrial: (...args: any[]) => mockStartTrial(...args),
  preparePaddleTrialPayment: (...args: any[]) => mockPreparePayment(...args),
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
  mockSandboxTrials = false;
  mockAccessState = null;
  mockUser = { id: 'captain', role: 'CAPTAIN_MOV', vesselId: 'vessel' };
  mockWidth = 390;
  mockSubscription = null;
  mockPreview
    .mockReset()
    .mockImplementation((_v, p, l) => Promise.resolve(result(p, l.countryCode)));
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
test('shows exact worldwide base totals before country selection, never as final tax-inclusive prices', () => {
  const screen = render(<VesselPlansScreen />);
  fireEvent.press(screen.getByText('Yearly'));
  expect(screen.getByText('US$1295.89 / year before tax')).toBeTruthy();
  expect(screen.getByText('US$2699.89 / year before tax')).toBeTruthy();
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
  expect(screen.getByText('US$79.99 base + US$16.00 VAT / tax')).toBeTruthy();
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
    fireEvent.press(screen.getByText('Set up billing details'));
    await waitFor(() =>
      expect(screen.getByText('Payment setup could not be confirmed.')).toBeTruthy()
    );
    expect(mockPreparePayment).toHaveBeenCalledWith(
      'vessel',
      'https://nautical-ops.com',
      mockSubscription.currentPeriodEnd
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
      'https://nautical-ops.com/checkout?transaction=' + transaction
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
