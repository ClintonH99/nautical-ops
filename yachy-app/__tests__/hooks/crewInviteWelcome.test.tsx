import { act, renderHook } from '@testing-library/react-native';
import { useCrewInviteWelcome } from '../../src/hooks/useCrewInviteWelcome';
import { getVesselSubscriptionAccess } from '../../src/services/subscription';
let mockState: any;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));
jest.mock('../../src/store', () => ({
  useAuthStore: Object.assign(() => mockState, { getState: () => mockState }),
}));
jest.mock('../../src/services/subscription', () => ({ getVesselSubscriptionAccess: jest.fn() }));
const read = jest.mocked(getVesselSubscriptionAccess);
const confirmed = (status = 'trialing', vesselId = 'vessel') =>
  ({
    state: 'entitled',
    subscription: { vesselId, status, currentPeriodEnd: '2099-01-01' },
  }) as any;
beforeEach(() => {
  mockState = {
    user: { id: 'captain', role: 'CAPTAIN_MOV', vesselId: 'vessel' },
    captainPaymentRequired: false,
    crewPaymentRequired: false,
  };
  read.mockReset().mockResolvedValue(confirmed());
});
it.each(['trialing', 'active'])('confirms %s with a fresh server read', async (status) => {
  read.mockResolvedValue(confirmed(status));
  const ui = renderHook(() => useCrewInviteWelcome(true));
  expect(ui.result.current.status).toBe('checking');
  await act(async () => {});
  expect(read).toHaveBeenCalledWith('vessel');
  expect(ui.result.current.status).toBe('ready');
});
it.each(['payment_required', 'never_subscribed', 'grace_period', 'unavailable'])(
  'does not congratulate on %s',
  async (state) => {
    read.mockResolvedValue({ ...confirmed(), state });
    const ui = renderHook(() => useCrewInviteWelcome(true));
    await act(async () => {});
    expect(ui.result.current.status).not.toBe('ready');
  }
);
it('does not accept another vessel or an expired date', async () => {
  read.mockResolvedValue(confirmed('trialing', 'other'));
  const ui = renderHook(() => useCrewInviteWelcome(true));
  await act(async () => {});
  expect(ui.result.current.status).toBe('ineligible');
  read.mockResolvedValue({
    state: 'entitled',
    subscription: { ...confirmed().subscription, currentPeriodEnd: '2020-01-01' },
  });
  await act(async () => ui.result.current.retry());
  expect(ui.result.current.status).toBe('ineligible');
});
it.each(['CREW', 'HOD'])('does not request or show the captain prompt for %s', async (role) => {
  mockState.user.role = role;
  const ui = renderHook(() => useCrewInviteWelcome(true));
  await act(async () => {});
  expect(read).not.toHaveBeenCalled();
  expect(ui.result.current.status).toBe('ineligible');
});
it('does not request without return intent or when restricted', async () => {
  const ui = renderHook<ReturnType<typeof useCrewInviteWelcome>, { requested: boolean }>(
    ({ requested }) => useCrewInviteWelcome(requested),
    {
      initialProps: { requested: false },
    }
  );
  await act(async () => {});
  mockState.captainPaymentRequired = true;
  ui.rerender({ requested: true });
  await act(async () => {});
  expect(read).not.toHaveBeenCalled();
  expect(ui.result.current.status).toBe('ineligible');
});
it('ignores a stale response after account changes', async () => {
  let finish!: (result: any) => void;
  read.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const ui = renderHook(() => useCrewInviteWelcome(true));
  mockState.user = { ...mockState.user, id: 'other', vesselId: 'other-vessel' };
  await act(async () => finish(confirmed()));
  expect(ui.result.current.status).not.toBe('ready');
});
it('retries a read failure without changing account access', async () => {
  read.mockRejectedValueOnce(new Error('network')).mockResolvedValue(confirmed());
  const ui = renderHook(() => useCrewInviteWelcome(true));
  await act(async () => {});
  expect(ui.result.current.status).toBe('unavailable');
  await act(async () => ui.result.current.retry());
  expect(ui.result.current.status).toBe('ready');
  expect(mockState.captainPaymentRequired).toBe(false);
});
