/**
 * Unit tests for AuthService
 * @jest-environment node
 */

// Mock supabase before auth is used
const mockSignInWithPassword = jest.fn();
const mockSignOut = jest.fn();
const mockGetSession = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockAuthOnAuthStateChange = jest.fn();

jest.mock('../../src/services/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
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
