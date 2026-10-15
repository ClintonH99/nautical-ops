/** @jest-environment jsdom */
const mockRpc = jest.fn();
const mockRandomUUID = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('expo-application', () => ({ applicationId: null }));
jest.mock('expo-device', () => ({}));
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));
jest.mock('expo-crypto', () => ({
  randomUUID: () => mockRandomUUID(),
  digestStringAsync: async (_algorithm: string, value: string) =>
    jest
      .requireActual<typeof import('node:crypto')>('node:crypto')
      .createHash('sha256')
      .update(value)
      .digest('hex'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
jest.mock('../../src/services/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
import {
  getCurrentDeviceFingerprint,
  registerCurrentDevice,
  releaseCurrentDevice,
} from '../../src/services/deviceAccess';
import { createHash } from 'node:crypto';

describe('web registration identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    document.cookie = 'nautical_ops_browser_id=; Path=/; Max-Age=0';
    mockRandomUUID
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValue('22222222-2222-4222-8222-222222222222');
    mockRpc.mockResolvedValue({ data: { allowed: true, active_device_count: 2 }, error: null });
  });

  it('sends one stable fingerprint for simultaneous login and background access checks', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => registerCurrentDevice()));
    expect(results.every((result) => result.state === 'allowed')).toBe(true);
    const fingerprints = mockRpc.mock.calls.map(([, args]) => args.p_device_fingerprint);
    expect(new Set(fingerprints).size).toBe(1);
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);
    // A later login and a reloaded module still read the same persistent ID.
    await expect(getCurrentDeviceFingerprint()).resolves.toBe(fingerprints[0]);
    jest.resetModules();
    const reloaded = jest.requireActual<typeof import('../../src/services/deviceAccess')>(
      '../../src/services/deviceAccess'
    );
    await expect(reloaded.getCurrentDeviceFingerprint()).resolves.toBe(fingerprints[0]);
  });

  it('keeps the exact fingerprint already registered by previous releases', async () => {
    const raw = '33333333-3333-4333-8333-333333333333';
    window.localStorage.setItem('nautical_ops_installation_device_id', raw);
    const expected = createHash('sha256').update(`nautical-ops-web:web:${raw}`).digest('hex');
    await expect(getCurrentDeviceFingerprint()).resolves.toBe(expected);
    expect(mockRandomUUID).not.toHaveBeenCalled();
  });

  it('does not renew a slot during a background token refresh', async () => {
    const spy = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await expect(registerCurrentDevice()).resolves.toEqual({
      state: 'unavailable',
      activeDeviceCount: null,
    });
    expect(mockRpc).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns the active-session mode so a full quota does not sign the user out', async () => {
    mockRpc.mockResolvedValue({
      data: {
        allowed: false,
        active_device_count: 2,
        mode: 'active_sessions',
        user_id: 'test-user',
        server_time: new Date().toISOString(),
      },
      error: null,
    });
    await expect(registerCurrentDevice()).resolves.toEqual({
      state: 'limit_reached',
      activeDeviceCount: 2,
      mode: 'active_sessions',
    });
  });

  it('rejects incomplete active-session metadata instead of opening the app', async () => {
    mockRpc.mockResolvedValue({
      data: { allowed: false, active_device_count: 2, mode: 'active_sessions' },
      error: null,
    });
    await expect(registerCurrentDevice()).resolves.toEqual({
      state: 'unavailable',
      activeDeviceCount: null,
    });
  });
  it('accepts saved-browser grants without a lease expiry', async () => {
    mockRpc.mockResolvedValue({
      data: {
        allowed: true,
        active_device_count: 2,
        mode: 'saved_browsers',
        user_id: 'test-user',
        server_time: new Date().toISOString(),
      },
      error: null,
    });
    await expect(registerCurrentDevice()).resolves.toEqual({
      state: 'allowed',
      activeDeviceCount: 2,
      mode: 'saved_browsers',
    });
  });
  it('requires confirmed slot release, without clearing the browser identity', async () => {
    const identity = await getCurrentDeviceFingerprint();
    mockRpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: true, error: null }) });
    await expect(releaseCurrentDevice()).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith('revoke_current_device');
    await expect(getCurrentDeviceFingerprint()).resolves.toBe(identity);
    mockRpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: false, error: null }) });
    await expect(releaseCurrentDevice()).rejects.toThrow('Could not release this browser slot');
    mockRpc.mockReturnValue({
      abortSignal: () =>
        Promise.resolve({ data: null, error: { message: 'Network request failed' } }),
    });
    await expect(releaseCurrentDevice()).rejects.toThrow('Could not release this browser slot');
  });
});
