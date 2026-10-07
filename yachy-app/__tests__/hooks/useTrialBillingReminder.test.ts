import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getVesselSubscriptionAccess } from '../../src/services/subscription';
import { useTrialBillingReminder } from '../../src/hooks/useTrialBillingReminder';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
  useIsFocused: () => true,
}));
jest.mock('../../src/services/subscription', () => ({ getVesselSubscriptionAccess: jest.fn() }));

const fetchAccess = jest.mocked(getVesselSubscriptionAccess);
const props = { enabled: true, userId: 'user', vesselId: 'vessel', role: 'CAPTAIN_MOV' };
const now = Date.parse('2026-10-07T12:00:00Z');
const access = {
  state: 'entitled' as const,
  subscription: {
    id: 'trial',
    vesselId: 'vessel',
    planTier: '1_5' as const,
    billingPeriod: 'monthly' as const,
    status: 'trialing' as const,
    paymentProvider: 'legacy_paddle' as const,
    currentPeriodStart: '2026-09-21T12:00:00Z',
    currentPeriodEnd: '2026-10-21T12:00:00Z',
    gracePeriodEnd: null,
    createdAt: '',
    updatedAt: '',
  },
};
beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  fetchAccess.mockResolvedValue(access);
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  jest.mocked(AsyncStorage.setItem).mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

test('dismisses immediately and remembers the exact trial without changing billing', async () => {
  const { result, unmount } = renderHook(() => useTrialBillingReminder(props));
  await waitFor(() => expect(result.current.reminder?.daysRemaining).toBe(14));
  const key = result.current.reminder!.key;
  act(() => result.current.dismiss());
  expect(result.current.reminder).toBeNull();
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(key, 'dismissed');
  expect(fetchAccess).toHaveBeenCalledTimes(1);
  unmount();
  jest.mocked(AsyncStorage.getItem).mockResolvedValue('dismissed');
  const reopened = renderHook(() => useTrialBillingReminder(props));
  await act(async () => {});
  expect(reopened.result.current.reminder).toBeNull();
});

test.each([
  { ...props, enabled: false },
  { ...props, role: 'CREW' },
  { ...props, role: 'HOD' },
])('does not fetch when disabled or unauthorized: %j', (input) => {
  const { result } = renderHook(() => useTrialBillingReminder(input));
  expect(fetchAccess).not.toHaveBeenCalled();
  expect(result.current.reminder).toBeNull();
});

test('subscription and storage failures do not block Home', async () => {
  fetchAccess.mockRejectedValueOnce(new Error('offline'));
  const first = renderHook(() => useTrialBillingReminder(props));
  await act(async () => {});
  expect(first.result.current.reminder).toBeNull();
  first.unmount();
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage'));
  const second = renderHook(() => useTrialBillingReminder(props));
  await act(async () => {});
  expect(second.result.current.reminder).toBeNull();
});

test('a late response cannot show the previous vessel trial', async () => {
  let resolve!: (value: typeof access) => void;
  fetchAccess.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  fetchAccess.mockResolvedValueOnce({ state: 'never_subscribed', subscription: null });
  const { result, rerender } = renderHook((input: typeof props) => useTrialBillingReminder(input), {
    initialProps: props,
  });
  rerender({ ...props, vesselId: 'different' });
  await act(async () => {
    resolve(access);
  });
  expect(result.current.reminder).toBeNull();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});

test('failed persistence still dismisses for this session', async () => {
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage'));
  const { result, rerender } = renderHook((input: typeof props) => useTrialBillingReminder(input), {
    initialProps: props,
  });
  await waitFor(() => expect(result.current.reminder).not.toBeNull());
  await act(async () => result.current.dismiss());
  rerender({ ...props, enabled: false });
  rerender(props);
  await act(async () => {});
  expect(result.current.reminder).toBeNull();
});
