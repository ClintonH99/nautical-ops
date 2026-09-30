const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockGetIosIdForVendorAsync = jest.fn();
const mockDigestStringAsync = jest.fn();
const mockRpc = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
  setItem: (...args: unknown[]) => mockSetItem(...args),
}));

jest.mock('expo-application', () => ({
  applicationId: 'com.nauticalops.app',
  getIosIdForVendorAsync: (...args: unknown[]) => mockGetIosIdForVendorAsync(...args),
  getAndroidId: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('fallback-installation-id'),
  digestStringAsync: (...args: unknown[]) => mockDigestStringAsync(...args),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

jest.mock('expo-device', () => ({ modelName: 'Test iPhone' }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('../../src/services/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import {
  getCurrentDeviceFingerprint,
  registerCurrentDevice,
  releaseCurrentDevice,
} from '../../src/services/deviceAccess';

describe('device access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetIosIdForVendorAsync.mockResolvedValue('ios-vendor-id');
    mockDigestStringAsync.mockResolvedValue('hashed-device-fingerprint');
  });

  it('hashes the app, platform, and native device identifier', async () => {
    await expect(getCurrentDeviceFingerprint()).resolves.toBe('hashed-device-fingerprint');
    expect(mockDigestStringAsync).toHaveBeenCalledWith(
      'SHA-256',
      'com.nauticalops.app:ios:ios-vendor-id'
    );
  });

  it('registers an allowed device through the protected RPC', async () => {
    mockRpc.mockResolvedValue({
      data: { allowed: true, active_device_count: 2 },
      error: null,
    });

    await expect(registerCurrentDevice()).resolves.toEqual({
      state: 'allowed',
      activeDeviceCount: 2,
    });
    expect(mockRpc).toHaveBeenCalledWith('register_user_device', {
      p_device_fingerprint: 'hashed-device-fingerprint',
      p_platform: 'ios',
      p_device_name: 'Test iPhone',
    });
  });

  it('reports the strict two-device limit from the server', async () => {
    mockRpc.mockResolvedValue({
      data: { allowed: false, active_device_count: 2 },
      error: null,
    });

    await expect(registerCurrentDevice()).resolves.toEqual({
      state: 'limit_reached',
      activeDeviceCount: 2,
    });
  });

  it('fails open when the device check is unavailable', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });

    await expect(registerCurrentDevice()).resolves.toEqual({
      state: 'unavailable',
      activeDeviceCount: null,
    });
  });

  it('releases only the current registered session', async () => {
    const abortSignal = jest.fn().mockResolvedValue({ data: true, error: null });
    mockRpc.mockReturnValue({ abortSignal });

    await releaseCurrentDevice();

    expect(mockRpc).toHaveBeenCalledWith('revoke_current_device');
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('cancels a stalled release so it cannot hold sign-out indefinitely', async () => {
    jest.useFakeTimers();
    mockRpc.mockReturnValue({
      abortSignal: (signal: AbortSignal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () =>
            resolve({ error: { message: 'Network request failed' } })
          );
        }),
    });
    const release = releaseCurrentDevice();
    await jest.advanceTimersByTimeAsync(3_001);
    await expect(release).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
