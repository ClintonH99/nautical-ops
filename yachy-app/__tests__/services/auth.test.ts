/**
 * Unit tests for AuthService
 * @jest-environment node
 */

// Mock supabase before auth is used
const mockSignInWithPassword = jest.fn();
const mockSignUp = jest.fn();
const mockSignOut = jest.fn();
const mockGetSession = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockAuthOnAuthStateChange = jest.fn();

jest.mock('../../src/services/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signUp: (...args: unknown[]) => mockSignUp(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (cb: unknown) => mockAuthOnAuthStateChange(cb),
    },
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

jest.mock('../../src/services/deviceAccess', () => ({
  registerCurrentDevice: jest.fn().mockResolvedValue({ state: 'allowed', activeDeviceCount: 1 }),
  releaseCurrentDevice: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/vessel', () => ({
  __esModule: true,
  default: {
    createVessel: jest.fn().mockResolvedValue({ id: 'solo-vessel', name: 'Crew Account' }),
  },
}));

// Mock expo modules to avoid native deps
jest.mock('expo-device', () => ({ isDevice: false }));
jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn().mockResolvedValue({ type: 'dismiss' }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('mock-uuid'),
  digestStringAsync: jest.fn().mockResolvedValue('mock-hash'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn().mockReturnValue('https://example.com/redirect'),
}));
jest.mock('expo-auth-session/build/QueryParams', () => ({
  getQueryParams: jest.fn().mockReturnValue({ params: {}, errorCode: null }),
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

import authService from '../../src/services/auth';

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('auth events', () => {
    afterEach(() => {
      jest.restoreAllMocks();
      jest.useRealTimers();
    });

    it('leaves initial sessions and successful token refreshes to bootstrap', async () => {
      jest.useFakeTimers();
      const unsubscribe = jest.fn();
      mockAuthOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
      const profile = jest.spyOn(authService, 'getUserProfileWithRetry');
      const callback = jest.fn();
      const subscription = authService.onAuthStateChange(callback);
      const event = mockAuthOnAuthStateChange.mock.calls[0][0];
      event('INITIAL_SESSION', { user: { id: 'one' } });
      event('TOKEN_REFRESHED', { user: { id: 'one' } });
      await jest.runAllTimersAsync();
      expect(profile).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      subscription.data.subscription.unsubscribe();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('releases the auth lock before querying and ignores a profile arriving after sign-out', async () => {
      jest.useFakeTimers();
      mockAuthOnAuthStateChange.mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      });
      let finish!: (value: Awaited<ReturnType<typeof authService.getUserProfileWithRetry>>) => void;
      const profile = jest.spyOn(authService, 'getUserProfileWithRetry').mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const callback = jest.fn();
      const subscription = authService.onAuthStateChange(callback);
      const event = mockAuthOnAuthStateChange.mock.calls[0][0];
      expect(event('SIGNED_IN', { user: { id: 'one' } })).toBeUndefined();
      expect(profile).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(0);
      expect(profile).toHaveBeenCalledWith('one');
      event('SIGNED_OUT', null);
      await jest.runAllTimersAsync();
      finish({ id: 'one' } as NonNullable<
        Awaited<ReturnType<typeof authService.getUserProfileWithRetry>>
      >);
      await Promise.resolve();
      expect(callback.mock.calls).toEqual([[null]]);
      subscription.data.subscription.unsubscribe();
    });
  });

  describe('validateInviteCode', () => {
    it('returns vessel when invite code is valid and not expired', async () => {
      const vessel = {
        id: 'v1',
        name: 'Test Vessel',
      };
      mockRpc.mockResolvedValue({ data: vessel, error: null });

      const result = await authService.validateInviteCode('ABC123');

      expect(result).toEqual(vessel);
      expect(mockRpc).toHaveBeenCalledWith('validate_vessel_invite_code', {
        p_invite_code: 'ABC123',
      });
    });

    it('throws when invite code is expired', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Invite code has expired' },
      });

      await expect(authService.validateInviteCode('EXPIRED')).rejects.toThrow(
        'Invite code has expired'
      );
    });

    it('throws when invite code not found', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      await expect(authService.validateInviteCode('INVALID')).rejects.toThrow(
        'Invalid invite code'
      );
    });

    it('throws when database returns error', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

      await expect(authService.validateInviteCode('BAD')).rejects.toThrow('DB error');
    });
  });

  describe('signIn', () => {
    it('surfaces clear message for invalid credentials', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      });

      await expect(authService.signIn({ email: 'a@b.com', password: 'wrong' })).rejects.toThrow(
        'Email Address or Password is Incorrect, Try Again.'
      );
    });

    it('returns user and session on success', async () => {
      const mockUser = {
        id: 'uid1',
        email: 'a@b.com',
      };
      mockSignInWithPassword.mockResolvedValue({
        data: { user: mockUser, session: {} },
        error: null,
      });
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: {
            id: 'uid1',
            email: 'a@b.com',
            name: 'User',
            position: 'Crew',
            department: 'INTERIOR',
            department_2: null,
            role: 'CREW',
            vessel_id: null,
            profile_photo: null,
            created_at: '2025-01-01',
            updated_at: '2025-01-01',
          },
          error: null,
        }),
      });

      const result = await authService.signIn({
        email: 'a@b.com',
        password: 'correct',
      });

      expect(result.user).toBeDefined();
      expect(result.user?.email).toBe('a@b.com');
      expect(result.session).toBeDefined();
    });
  });

  describe('signUp', () => {
    it('creates a private Crew workspace when no invite code is provided', async () => {
      const mockedVesselService = jest.requireMock('../../src/services/vessel').default;
      mockSignUp.mockResolvedValue({
        data: { user: { id: 'new-crew' }, session: { access_token: 'token' } },
        error: null,
      });

      const insert = jest.fn().mockResolvedValue({ error: null });
      const usersQuery = {
        insert,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: {
            id: 'new-crew',
            email: 'crew@example.com',
            name: 'New Crew',
            position: 'Deckhand',
            department: 'EXTERIOR',
            department_2: null,
            contract_type: 'permanent',
            role: 'CREW',
            vessel_id: 'solo-vessel',
            profile_photo: null,
            created_at: '2026-09-10T12:00:00.000Z',
            updated_at: '2026-09-10T12:00:00.000Z',
          },
          error: null,
        }),
      };
      mockFrom.mockImplementation((table: string) => {
        expect(table).toBe('users');
        return usersQuery;
      });

      const result = await authService.signUp({
        email: 'crew@example.com',
        password: 'password123',
        name: 'New Crew',
        position: 'Deckhand',
        department: 'EXTERIOR',
        contractType: 'permanent',
      });

      expect(mockedVesselService.createVessel).toHaveBeenCalledWith({
        name: 'Crew Account',
        isSolo: true,
      });
      expect(mockRpc).not.toHaveBeenCalled();
      expect(insert).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'new-crew',
          role: 'CREW',
        }),
      ]);
      expect(insert.mock.calls[0][0][0]).not.toHaveProperty('vessel_id');
      expect(result.user?.vesselId).toBe('solo-vessel');
    });
  });

  describe('signOut', () => {
    it('calls supabase.auth.signOut', async () => {
      mockSignOut.mockResolvedValue({ error: null });

      await authService.signOut();

      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('throws on signOut error', async () => {
      mockSignOut.mockResolvedValue({ error: { message: 'Sign out failed' } });

      await expect(authService.signOut()).rejects.toBeDefined();
    });
  });

  describe('getSession', () => {
    it('distinguishes a temporary outage from a confirmed signed-out session during bootstrap', async () => {
      const error = new Error('Network request failed');
      mockGetSession.mockResolvedValue({ data: { session: null }, error });
      await expect(authService.getSession({ throwOnTransient: true })).rejects.toBe(error);
      expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('still clears an explicitly revoked refresh token', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: new Error('Refresh token revoked'),
      });
      mockSignOut.mockResolvedValue({ error: null });
      await expect(authService.getSession({ throwOnTransient: true })).resolves.toBeNull();
      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
    });
    it('returns session when present', async () => {
      const session = { access_token: 'tok' };
      mockGetSession.mockResolvedValue({ data: { session }, error: null });

      const result = await authService.getSession();

      expect(result).toEqual(session);
    });

    it('returns null on error', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: { message: 'Error' },
      });

      const result = await authService.getSession();

      expect(result).toBeNull();
    });
  });
});
