// This key is shared with the original AsyncStorage implementation. Keeping it
// preserves existing registrations when the web app is updated.
const STORAGE_KEY = 'nautical_ops_installation_device_id';
const COOKIE_KEY = 'nautical_ops_browser_id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let pending: Promise<string> | undefined;

function readCookie(): string | null {
  try {
    const value = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_KEY}=`))
      ?.slice(COOKIE_KEY.length + 1);
    return value && UUID.test(value) ? value : null;
  } catch {
    return null;
  }
}

function restoreOrCreate(createId: () => string): string {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    /* Try the cookie. */
  }
  const cookie = readCookie();
  const id = (stored && UUID.test(stored) ? stored : null) || cookie || createId();
  let persisted = false;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
    persisted = window.localStorage.getItem(STORAGE_KEY) === id;
  } catch {
    /* Cookie storage may still be available. */
  }
  try {
    // Host-only: preview sites and other subdomains cannot set this identity.
    // It is a random installation ID, never a login token or personal details.
    document.cookie = `${COOKIE_KEY}=${id}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
    persisted = readCookie() === id || persisted;
  } catch {
    /* Local storage may still be available. */
  }
  if (!persisted) {
    throw new Error(
      'This browser cannot remember this device. Allow website storage and try again.'
    );
  }
  return id;
}

/** A single persistent identity per browser profile and website, across logins. */
export function getBrowserInstallationId(createId: () => string): Promise<string> {
  if (!pending) {
    pending = Promise.resolve()
      .then(() => {
        // Serialize initialization across tabs too. The synchronous fallback has
        // no asynchronous read/write gap within a page on older browsers.
        if (typeof navigator !== 'undefined' && navigator.locks?.request) {
          return navigator.locks.request(STORAGE_KEY, () => restoreOrCreate(createId));
        }
        return restoreOrCreate(createId);
      })
      .finally(() => {
        pending = undefined;
      });
  }
  return pending;
}

/** Labels help people choose a device; they are never used as identity proof. */
export function getBrowserDeviceLabel(userAgent: string, platform = '', touchPoints = 0): string {
  const device =
    /iPad/i.test(userAgent) || (platform === 'MacIntel' && touchPoints > 1)
      ? 'iPad'
      : /iPhone/i.test(userAgent)
        ? 'iPhone'
        : /Android/i.test(userAgent)
          ? 'Android'
          : /Macintosh|Mac OS X/i.test(userAgent)
            ? 'Mac'
            : /Windows/i.test(userAgent)
              ? 'Windows'
              : /CrOS/i.test(userAgent)
                ? 'Chromebook'
                : /Linux/i.test(userAgent)
                  ? 'Linux'
                  : '';
  const browser = /Edg(?:e|A|iOS)?\//i.test(userAgent)
    ? 'Edge'
    : /OPR\/|OPiOS\//i.test(userAgent)
      ? 'Opera'
      : /Firefox\/|FxiOS\//i.test(userAgent)
        ? 'Firefox'
        : /Chrome\/|CriOS\//i.test(userAgent)
          ? 'Chrome'
          : /Safari\//i.test(userAgent)
            ? 'Safari'
            : 'Web browser';
  return device ? `${browser} on ${device}` : browser;
}
