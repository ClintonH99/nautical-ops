/** @jest-environment jsdom */
import {
  getBrowserInstallationId,
  getBrowserDeviceLabel,
} from '../../src/utils/browserDeviceIdentity';

const KEY = 'nautical_ops_installation_device_id';
const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';

describe('persistent web device identity', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
    document.cookie = 'nautical_ops_browser_id=; Path=/; Max-Age=0';
  });

  it('keeps one identifier through 500 visits without counting sign-in sessions', async () => {
    const create = jest.fn().mockReturnValueOnce(FIRST).mockReturnValue(SECOND);
    for (let visit = 0; visit < 500; visit++) {
      await expect(getBrowserInstallationId(create)).resolves.toBe(FIRST);
    }
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('creates only one identifier when startup checks run together', async () => {
    const create = jest.fn().mockReturnValueOnce(FIRST).mockReturnValue(SECOND);
    const ids = await Promise.all(
      Array.from({ length: 50 }, () => getBrowserInstallationId(create))
    );
    expect(new Set(ids)).toEqual(new Set([FIRST]));
    expect(window.localStorage.getItem(KEY)).toBe(FIRST);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('retains the existing installation when upgrading from AsyncStorage', async () => {
    window.localStorage.setItem(KEY, FIRST);
    const create = jest.fn(() => SECOND);
    await expect(getBrowserInstallationId(create)).resolves.toBe(FIRST);
    expect(create).not.toHaveBeenCalled();
    expect(document.cookie).toContain(`nautical_ops_browser_id=${FIRST}`);
  });

  it('restores the same installation if local storage disappears but its cookie survives', async () => {
    await getBrowserInstallationId(() => FIRST);
    window.localStorage.removeItem(KEY);
    await expect(getBrowserInstallationId(() => SECOND)).resolves.toBe(FIRST);
    expect(window.localStorage.getItem(KEY)).toBe(FIRST);
  });

  it('restores the cookie from existing local storage', async () => {
    await getBrowserInstallationId(() => FIRST);
    document.cookie = 'nautical_ops_browser_id=; Path=/; Max-Age=0';
    await expect(getBrowserInstallationId(() => SECOND)).resolves.toBe(FIRST);
    expect(document.cookie).toContain(FIRST);
  });

  it('keeps the legacy local identifier authoritative if stores disagree', async () => {
    window.localStorage.setItem(KEY, FIRST);
    document.cookie = `nautical_ops_browser_id=${SECOND}; Path=/`;
    await expect(getBrowserInstallationId(() => SECOND)).resolves.toBe(FIRST);
    expect(document.cookie).toContain(FIRST);
  });

  it('refuses an ephemeral identity when all persistent storage is unavailable, then allows retry', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const cookie = jest.spyOn(document, 'cookie', 'set').mockImplementation(() => {});
    await expect(getBrowserInstallationId(() => FIRST)).rejects.toThrow(
      'cannot remember this device'
    );
    jest.restoreAllMocks();
    await expect(getBrowserInstallationId(() => SECOND)).resolves.toBe(SECOND);
    expect(cookie).toHaveBeenCalled();
  });

  it('uses persistent cookies when local storage is unavailable', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await expect(getBrowserInstallationId(() => FIRST)).resolves.toBe(FIRST);
    await expect(getBrowserInstallationId(() => SECOND)).resolves.toBe(FIRST);
  });

  it('uses the browser lock to serialize creation across tabs', async () => {
    const request = jest.fn(async (_key, callback) => callback());
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
    try {
      await expect(getBrowserInstallationId(() => FIRST)).resolves.toBe(FIRST);
      expect(request).toHaveBeenCalledWith(KEY, expect.any(Function));
    } finally {
      Reflect.deleteProperty(navigator, 'locks');
    }
  });

  it('gives a genuinely fresh browser its own identifier after both stores are cleared', async () => {
    await getBrowserInstallationId(() => FIRST);
    window.localStorage.clear();
    document.cookie = 'nautical_ops_browser_id=; Path=/; Max-Age=0';
    await expect(getBrowserInstallationId(() => SECOND)).resolves.toBe(SECOND);
  });

  it.each([
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Version/26.6.2 Mobile/15E148 Safari/604.1',
      '',
      0,
      'Safari on iPhone',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/141.0.0.0 Safari/537.36',
      'MacIntel',
      0,
      'Chrome on Mac',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/26.0 Safari/605.1.15',
      'MacIntel',
      5,
      'Safari on iPad',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0) Chrome/141.0.0.0 Safari/537.36 Edg/141.0',
      '',
      0,
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7) CriOS/141.0 Mobile Safari/604.1',
      '',
      0,
      'Chrome on iPhone',
    ],
  ])('labels %s clearly without using it as a device key', (ua, platform, touch, expected) => {
    expect(getBrowserDeviceLabel(ua as string, platform as string, touch as number)).toBe(expected);
  });
});
