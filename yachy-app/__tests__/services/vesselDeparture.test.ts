const mockSignIn = jest.fn();
const mockProfile = jest.fn();
const mockSession = jest.fn();
const mockSignOut = jest.fn();
const mockInvoke = jest.fn();
const mockDevice = jest.fn();
const mockSubscriptionAccess = jest.fn();
jest.mock('../../src/services/subscription', () => ({
  getVesselSubscriptionAccess: (...args: unknown[]) => mockSubscriptionAccess(...args),
}));
const mockStore = {
  user: null as any,
  deferUserUpdate: false,
  setDeferUserUpdate: jest.fn((value: boolean) => {
    mockStore.deferUserUpdate = value;
  }),
  setUser: jest.fn(),
  setLoginNotice: jest.fn(),
  setCaptainPaymentRequired: jest.fn(),
};
jest.mock('../../src/store', () => ({ useAuthStore: { getState: () => mockStore } }));
jest.mock('../../src/services/auth', () => ({
  __esModule: true,
  default: {
    signIn: (...args: unknown[]) => mockSignIn(...args),
    getUserProfile: (...args: unknown[]) => mockProfile(...args),
  },
}));
jest.mock('../../src/services/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockSession(),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));
jest.mock('../../src/services/deviceAccess', () => ({
  registerCurrentDevice: () => mockDevice(),
  DEVICE_LIMIT_MESSAGE: 'Device limit reached',
}));

import {
  leaveVesselForAccount,
  invokeVesselAction,
  isOnlyCaptainError,
} from '../../src/services/vesselDeparture';

const credentials = { email: 'crew@example.com', password: 'test-password' };
const oldUser = { id: 'u1', role: 'CREW', vesselId: 'unpaid-vessel' };
const freshUser = { ...oldUser, vesselId: 'private-vessel', vesselCreationUnlocked: true };

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.user = null;
  mockStore.deferUserUpdate = false;
  mockSignIn.mockImplementation(async () => {
    expect(mockStore.deferUserUpdate).toBe(true);
    return { user: oldUser };
  });
  mockDevice.mockResolvedValue({ state: 'allowed' });
  mockSubscriptionAccess.mockResolvedValue({ state: 'payment_required' });
  mockSession.mockResolvedValue({ data: { session: { access_token: 'verified-token' } } });
  mockInvoke.mockResolvedValue({
    data: { success: true, vessel_id: 'private-vessel' },
    error: null,
  });
  mockProfile.mockResolvedValue(freshUser);
  mockSignOut.mockResolvedValue({ error: null });
});

it('authenticates and moves an unpaid member without requiring subscription access', async () => {
  await expect(leaveVesselForAccount(credentials)).resolves.toEqual(freshUser);
  expect(mockSignIn).toHaveBeenCalledWith(credentials);
  expect(mockInvoke).toHaveBeenCalledWith('leave-vessel', {
    headers: { Authorization: 'Bearer verified-token' },
  });
  expect(mockStore.setUser).toHaveBeenCalledWith(freshUser);
  expect(mockStore.setLoginNotice).toHaveBeenCalledWith(null);
  expect(mockStore.setCaptainPaymentRequired).toHaveBeenCalledWith(false);
  expect(mockStore.deferUserUpdate).toBe(false);
  expect(mockSignOut).not.toHaveBeenCalled();
});

it.each([false, true])(
  'routes every unpaid captain to See Plans without departure (existing session=%s)',
  async (existingSession) => {
    const captain = { ...oldUser, role: 'CAPTAIN_MOV' };
    mockStore.user = existingSession ? captain : null;
    mockSignIn.mockResolvedValue({ user: captain });
    await expect(leaveVesselForAccount(existingSession ? undefined : credentials)).resolves.toEqual(
      captain
    );
    expect(mockStore.setCaptainPaymentRequired).toHaveBeenCalledWith(true);
    expect(mockStore.setUser).toHaveBeenCalledWith(captain);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockStore.deferUserUpdate).toBe(false);
  }
);

it('does not invoke departure with incorrect credentials', async () => {
  mockSignIn.mockRejectedValue(new Error('Email Address or Password is Incorrect, Try Again.'));
  await expect(leaveVesselForAccount(credentials)).rejects.toThrow(
    'Email Address or Password is Incorrect'
  );
  expect(mockInvoke).not.toHaveBeenCalled();
  expect(mockStore.setUser).toHaveBeenCalledWith(null);
  expect(mockStore.deferUserUpdate).toBe(false);
});

it.each(['limit_reached', 'unavailable'])(
  'does not bypass device authorization (%s)',
  async (state) => {
    mockDevice.mockResolvedValue({ state });
    await expect(leaveVesselForAccount(credentials)).rejects.toThrow();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  }
);

it.each([false, true])('preserves the sole-captain HTTP guard (clone=%s)', async (clone) => {
  const body = { json: async () => ({ error: 'You are the only Captain/MOV on this vessel.' }) };
  mockInvoke.mockResolvedValue({
    data: null,
    error: { context: clone ? { ...body, clone: () => body } : body },
  });
  await expect(leaveVesselForAccount(credentials)).rejects.toThrow('only Captain/MOV');
  expect(mockProfile).not.toHaveBeenCalled();
  expect(mockStore.setUser).not.toHaveBeenCalledWith(freshUser);
});

it('does not interpret an unavailable subscription check as confirmed non-payment', async () => {
  mockSignIn.mockResolvedValue({ user: { ...oldUser, role: 'CAPTAIN_MOV' } });
  mockSubscriptionAccess.mockResolvedValue({ state: 'unavailable' });
  await expect(leaveVesselForAccount(credentials)).rejects.toThrow('Could not check');
  expect(mockStore.setCaptainPaymentRequired).not.toHaveBeenCalledWith(true);
  expect(mockInvoke).not.toHaveBeenCalled();
});

it.each(['entitled', 'grace_period', 'never_subscribed'])(
  'keeps normal captain access unchanged for %s and does not use crew departure',
  async (state) => {
    const captain = { ...oldUser, role: 'CAPTAIN_MOV' };
    mockSignIn.mockResolvedValue({ user: captain });
    mockSubscriptionAccess.mockResolvedValue({ state });
    await leaveVesselForAccount(credentials);
    expect(mockStore.setCaptainPaymentRequired).toHaveBeenCalledWith(false);
    expect(mockStore.setUser).toHaveBeenCalledWith(captain);
    expect(mockInvoke).not.toHaveBeenCalled();
  }
);

it('retains HOD recovery to the server-issued private Crew account', async () => {
  mockSignIn.mockResolvedValue({ user: { ...oldUser, role: 'HOD' } });
  await expect(leaveVesselForAccount(credentials)).resolves.toEqual(freshUser);
  expect(mockInvoke).toHaveBeenCalled();
  expect(mockSubscriptionAccess).not.toHaveBeenCalled();
});

it.each([null, oldUser])(
  'never restores the old vessel after a successful departure with a failed/stale profile refresh',
  async (profile) => {
    mockProfile.mockResolvedValue(profile);
    await expect(leaveVesselForAccount(credentials)).rejects.toThrow('You have left the vessel');
    expect(mockStore.setUser).toHaveBeenCalledWith(null);
    expect(mockStore.setUser).not.toHaveBeenCalledWith(oldUser);
    expect(mockSignOut).toHaveBeenCalled();
  }
);

it('rejects duplicate recovery while another account operation is active', async () => {
  mockStore.deferUserUpdate = true;
  await expect(leaveVesselForAccount(credentials)).rejects.toThrow('in progress');
  expect(mockSignIn).not.toHaveBeenCalled();
  expect(mockStore.setDeferUserUpdate).not.toHaveBeenCalled();
});

it('does not call the function without a session', async () => {
  mockSession.mockResolvedValue({ data: { session: null } });
  await expect(invokeVesselAction('leave-vessel')).rejects.toThrow('verify your session');
  expect(mockInvoke).not.toHaveBeenCalled();
});

it('does not mislabel network or malformed responses as the last-captain guard', async () => {
  mockInvoke.mockResolvedValue({
    data: null,
    error: {
      context: {
        json: async () => {
          throw new Error('Not JSON');
        },
      },
    },
  });
  await expect(invokeVesselAction('leave-vessel')).rejects.toThrow('contact support');
  expect(isOnlyCaptainError('Network unavailable')).toBe(false);
});
