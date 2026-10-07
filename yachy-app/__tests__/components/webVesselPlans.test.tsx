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
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 844, scale: 1, fontScale: 1 }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('../../src/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({
    subscription: mockSubscription,
    accessState: mockSubscription ? 'entitled' : 'never_subscribed',
    isLoading: false,
    refetch: mockRefetch,
  }),
}));
jest.mock('../../src/services/paddleBilling', () => ({
  paddleCheckoutEnabled: false,
  paddleEnvironment: 'sandbox',
  preparePaddleCheckout: jest.fn(),
}));
jest.mock('../../src/services/paddlePricing', () => ({
  previewPaddlePrices: (...args: any[]) => mockPreview(...args),
  usd: (n: number) => 'US$' + (n / 100).toFixed(2),
}));
jest.mock('../../src/store', () => ({
  useAuthStore: (selector: any) => selector({ user: mockUser }),
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
  mockUser = { id: 'captain', role: 'CAPTAIN_MOV', vesselId: 'vessel' };
  mockWidth = 390;
  mockSubscription = null;
  mockPreview
    .mockReset()
    .mockImplementation((_v, p, l) => Promise.resolve(result(p, l.countryCode)));
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
