import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { VesselPlansScreen } from '../../src/screens/VesselPlansScreen';
import * as iap from '../../src/services/iap';
import { showManageSubscriptionsIOS } from 'expo-iap';

const mockUser = { id: 'captain', role: 'CAPTAIN_MOV', vesselId: 'vessel' };
const mockPosthog = { capture: jest.fn() };
const mockRefetch = jest.fn().mockResolvedValue({});
const mockSubscription = {
  planTier: '1_5',
  billingPeriod: 'monthly',
  currentPeriodEnd: '2026-11-01',
};
const mockSetPayment = jest.fn();
let mockDark = false;
let mockRestricted = false;
jest.mock('../../src/services/vesselDeparture', () => ({
  leaveVesselForAccount: jest.fn(),
  isOnlyCaptainError: jest.fn(),
}));
jest.mock('../../src/store', () => ({
  useAuthStore: () => ({
    user: mockUser,
    captainPaymentRequired: mockRestricted,
    setCaptainPaymentRequired: mockSetPayment,
  }),
}));
jest.mock('../../src/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({
    hasActiveSubscription: !mockRestricted,
    subscription: mockRestricted ? null : mockSubscription,
    isLoading: false,
    refetch: mockRefetch,
  }),
}));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    isDark: mockDark,
    surface: '#fff',
    accent: '#1E3A8A',
    controlSelected: '#1E3A8A',
    textOnAccent: '#fff',
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('posthog-react-native', () => ({ usePostHog: () => mockPosthog }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));
jest.mock('expo-iap', () => ({ showManageSubscriptionsIOS: jest.fn().mockResolvedValue([]) }));
jest.mock('../../src/services/iap', () => ({
  initIAP: jest.fn().mockResolvedValue(true),
  endIAP: jest.fn(),
  fetchIAPProducts: jest.fn(),
  purchaseSubscription: jest.fn(),
  setupIAPListeners: jest.fn(() => jest.fn()),
  verifyAndActivateIAPPurchase: jest.fn().mockResolvedValue({ success: true }),
  restoreAndActivateIAPPurchases: jest.fn(),
}));
jest.mock('../../src/components', () => ({
  Button: jest.requireActual('../../src/components/Button').Button,
  PageHeader: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRestricted = false;
  Platform.OS = 'ios';
  jest.mocked(iap.fetchIAPProducts).mockResolvedValue([
    { id: 'com.nauticalops.app.crew_1_5_v2.monthly', displayPrice: '$79.99' },
    { id: 'com.nauticalops.app.crew_6_10_v2.12months', displayPrice: '$969.00' },
  ] as any);
  jest
    .mocked(iap.purchaseSubscription)
    .mockResolvedValue({ id: 'transaction', transactionId: 'transaction' });
});

it('offers payment and cancellation, but no departure, on the payment-restricted screen', async () => {
  mockRestricted = true;
  const ui = render(<VesselPlansScreen navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);
  await act(async () => {});
  expect(ui.queryByText('Leave Vessel')).toBeNull();
  expect(ui.queryByText('Confirm and Leave Vessel')).toBeNull();
  expect(ui.getByText('Subscribe Now')).toBeTruthy();
  await act(async () => {
    fireEvent.press(ui.getByText('Manage / Cancel Subscription'));
  });
  expect(showManageSubscriptionsIOS).toHaveBeenCalledTimes(1);
  expect(mockSetPayment).not.toHaveBeenCalled();
  expect(mockRefetch).toHaveBeenCalled();
});

describe.each([false, true])('existing subscriber plan choices (night=%s)', (dark) => {
  beforeEach(() => {
    mockDark = dark;
  });
  it('keeps the current plan visible while choosing 6-10 yearly and uses the correct SKU', async () => {
    const ui = render(
      <VesselPlansScreen navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />
    );
    await act(async () => {});
    expect(ui.getByRole('button', { name: 'Current Plan' })).toBeDisabled();
    fireEvent.press(ui.getByText('Yearly'));
    fireEvent.press(ui.getByText('6-10 Crew Members'));
    expect(ui.getByText('1-5 Crew Members · Monthly')).toBeTruthy();
    expect(ui.getByRole('button', { name: 'Change Plan' })).not.toBeDisabled();
    await act(async () => {
      fireEvent.press(ui.getByRole('button', { name: 'Change Plan' }));
    });
    expect(iap.purchaseSubscription).toHaveBeenCalledWith(
      'com.nauticalops.app.crew_6_10_v2.12months',
      'vessel'
    );
    expect(iap.verifyAndActivateIAPPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'transaction' }),
      'vessel'
    );
    expect(mockRefetch).toHaveBeenCalled();
  });
  it('opens native Apple management and refreshes on return', async () => {
    const ui = render(<VesselPlansScreen navigation={{ goBack: jest.fn() }} />);
    await act(async () => {});
    await act(async () => {
      fireEvent.press(ui.getByText('Manage Apple Subscription'));
    });
    expect(showManageSubscriptionsIOS).toHaveBeenCalledTimes(1);
    expect(mockRefetch).toHaveBeenCalledTimes(2);
  });
  it('does not purchase an unavailable StoreKit product', async () => {
    jest.mocked(iap.fetchIAPProducts).mockResolvedValue([]);
    const ui = render(<VesselPlansScreen navigation={{ goBack: jest.fn() }} />);
    await act(async () => {});
    fireEvent.press(ui.getByText('Yearly'));
    fireEvent.press(ui.getByText('6-10 Crew Members'));
    expect(ui.getByRole('button', { name: 'Change Plan' })).toBeDisabled();
    expect(iap.purchaseSubscription).not.toHaveBeenCalled();
  });
});
