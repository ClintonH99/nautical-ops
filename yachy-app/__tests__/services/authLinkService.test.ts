/**
 * Unit tests for auth link service (QR code sign-in)
 * @jest-environment node
 */

const mockFetch = jest.fn();
let mockIsSupabaseConfigured = true;

jest.mock('../../src/services/supabase', () => ({
  SUPABASE_URL: 'https://real-project.supabase.co',
  isSupabaseConfigured: () => mockIsSupabaseConfigured,
}));

// Must import after mock
import {
  createAuthCode,
  getAuthLink,
  claimAuthLink,
} from '../../src/services/authLinkService';

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch;
  mockIsSupabaseConfigured = true;
});

describe('authLinkService', () => {
  describe('createAuthCode', () => {
    it('returns error when Supabase not configured', async () => {
      mockIsSupabaseConfigured = false;
      const result = await createAuthCode();
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toContain(
        'Supabase not configured'
      );
    });

    it('returns code when API succeeds', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ code: 'ABC-123' }),
      });
      const result = await createAuthCode();
      expect(result).toHaveProperty('code');
      expect((result as { code: string }).code).toBe('ABC-123');
    });

    it('returns error on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('fetch failed'));
      const result = await createAuthCode();
      expect(result).toHaveProperty('error');
    });

    it('returns error when API returns non-ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      });
      const result = await createAuthCode();
      expect(result).toHaveProperty('error');
    });
  });

  describe('getAuthLink', () => {
    it('returns error when Supabase not configured', async () => {
      mockIsSupabaseConfigured = false;
      const result = await getAuthLink('ABC');
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toBe('Supabase not configured');
    });

    it('returns action_link when ready', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ action_link: 'https://auth.link/xyz' }),
      });
      const result = await getAuthLink('ABC');
      expect(result).toHaveProperty('action_link');
      expect((result as { action_link: string }).action_link).toBe(
        'https://auth.link/xyz'
      );
    });

    it('returns pending when QR not yet scanned', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'pending' }),
      });
      const result = await getAuthLink('ABC');
      expect(result).toHaveProperty('status');
      expect((result as { status: string }).status).toBe('pending');
    });
  });

  describe('claimAuthLink', () => {
    it('returns error when Supabase not configured', async () => {
      mockIsSupabaseConfigured = false;
      const result = await claimAuthLink('ABC', 'token');
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toBe('Supabase not configured');
    });

    it('returns success when claim succeeds', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });
      const result = await claimAuthLink('ABC', 'access-token');
      expect(result).toEqual({ success: true });
    });
  });
});
