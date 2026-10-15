/** @jest-environment jsdom */
import {
  recordBrowserSessionResult,
  useBrowserSessionLease,
  expireBrowserSessionUi,
  isBrowserSessionVisible,
  SESSION_LEASE_MS,
} from '../../src/services/browserSessionLease';
beforeEach(() =>
  useBrowserSessionLease.setState({ userId: null, status: 'checking', validUntil: 0 })
);
const issued = {
  mode: 'active_sessions',
  user_id: 'test-user',
  allowed: true,
  server_time: '2026-10-15T12:00:00Z',
  lease_expires_at: '2026-10-15T13:00:00Z',
};
it('keeps a slot for one hour with a clock-skew independent deadline', () => {
  recordBrowserSessionResult(issued, 1000);
  expect(useBrowserSessionLease.getState().validUntil).toBe(1000 + SESSION_LEASE_MS);
  expireBrowserSessionUi(1000 + SESSION_LEASE_MS - 1);
  expect(useBrowserSessionLease.getState().status).toBe('allowed');
  expireBrowserSessionUi(1000 + SESSION_LEASE_MS);
  expect(useBrowserSessionLease.getState().status).toBe('checking');
  expect(useBrowserSessionLease.getState().userId).toBe('test-user');
});
it('renews the same slot without accumulating time beyond one hour', () => {
  recordBrowserSessionResult(issued, 1000);
  recordBrowserSessionResult(issued, 31_000);
  expect(useBrowserSessionLease.getState().validUntil).toBe(31_000 + SESSION_LEASE_MS);
});
it('does not interpret missing or invalid lease metadata as access', () => {
  recordBrowserSessionResult({ ...issued, lease_expires_at: 'not-a-date' });
  expect(useBrowserSessionLease.getState().status).toBe('unavailable');
});
it('limits access without treating expiry as revocation', () => {
  recordBrowserSessionResult({ ...issued, allowed: false, reason: 'active_session_limit' });
  expect(useBrowserSessionLease.getState().status).toBe('limited');
  recordBrowserSessionResult({ ...issued, allowed: false, reason: 'session_revoked' });
  expect(useBrowserSessionLease.getState().status).toBe('revoked');
});
it('only renews visible browser pages, not hidden ones', () => {
  const spy = jest.spyOn(document, 'visibilityState', 'get');
  spy.mockReturnValue('hidden');
  expect(isBrowserSessionVisible()).toBe(false);
  spy.mockReturnValue('visible');
  expect(isBrowserSessionVisible()).toBe(true);
  spy.mockRestore();
});
it('keeps a saved browser indefinitely without extending authentication tokens', () => {
  recordBrowserSessionResult({ mode: 'saved_browsers', user_id: 'test-user', allowed: true });
  expect(useBrowserSessionLease.getState().validUntil).toBe(Infinity);
  expireBrowserSessionUi(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
  expect(useBrowserSessionLease.getState().status).toBe('allowed');
  recordBrowserSessionResult({
    mode: 'saved_browsers',
    user_id: 'test-user',
    allowed: false,
    reason: 'session_revoked',
  });
  expect(useBrowserSessionLease.getState().status).toBe('revoked');
});
