/**
 * Polyfill window.location for React Native / Expo Go.
 * Prevents "Cannot read property 'origin' of undefined" when expo-auth-session
 * or expo-linking web paths run in a context where window exists but location doesn't.
 */
try {
  const g = typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : null;
  const w = g && (g as any).window;
  const hasWindow = typeof w !== 'undefined';
  const hasLocation = hasWindow && (w as any).location != null;
  const hasOrigin = hasLocation && (w as any).location.origin != null;

  if (hasWindow && !hasLocation) {
    (w as any).location = { origin: 'nauticalops://', href: 'nauticalops://', protocol: 'nauticalops:', host: '', hostname: '' };
  } else if (hasWindow && hasLocation && !hasOrigin) {
    (w as any).location.origin = (w as any).location.origin || 'nauticalops://';
  }
} catch {
  // Ignore polyfill errors
}
