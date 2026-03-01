/**
 * Development-only logger. No-op in production to avoid leaking sensitive data.
 */
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

export const devLog = (...args: unknown[]) => {
  if (isDev) console.log(...args);
};

export const devError = (...args: unknown[]) => {
  if (isDev) console.error(...args);
};

export const devWarn = (...args: unknown[]) => {
  if (isDev) console.warn(...args);
};
