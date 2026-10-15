import { create } from 'zustand';

export const SESSION_HEARTBEAT_MS = 30_000;
export const SESSION_LEASE_MS = 60 * 60 * 1000;
type LeaseStatus = 'checking' | 'allowed' | 'limited' | 'unavailable' | 'revoked';
export const useBrowserSessionLease = create<{
  userId: string | null;
  status: LeaseStatus;
  validUntil: number;
}>(() => ({ userId: null, status: 'checking', validUntil: 0 }));

/** Saved browser reservations have no inactivity expiry. Legacy lease results
 * remain readable during deployment; server authorization is always authoritative.
 */
export function recordBrowserSessionResult(
  data: {
    mode?: string;
    user_id?: string;
    allowed?: boolean;
    reason?: string;
    lease_expires_at?: string;
    server_time?: string;
  },
  requestStartedAt = Date.now()
) {
  if (!['active_sessions', 'saved_browsers'].includes(data.mode ?? '') || !data.user_id) return;
  const saved = data.mode === 'saved_browsers';
  const duration = Date.parse(data.lease_expires_at ?? '') - Date.parse(data.server_time ?? '');
  const allowed = data.allowed === true && (saved || (Number.isFinite(duration) && duration > 0));
  useBrowserSessionLease.setState({
    userId: data.user_id,
    status: allowed
      ? 'allowed'
      : data.reason === 'session_revoked'
        ? 'revoked'
        : data.allowed === false
          ? 'limited'
          : 'unavailable',
    // Subtract round-trip time conservatively by anchoring to request start.
    validUntil: allowed
      ? saved
        ? Infinity
        : requestStartedAt + Math.min(duration, SESSION_LEASE_MS)
      : 0,
  });
}

export function expireBrowserSessionUi(now = Date.now()) {
  const state = useBrowserSessionLease.getState();
  if (state.status === 'allowed' && now >= state.validUntil)
    useBrowserSessionLease.setState({ status: 'checking' });
}

/** Check revocation on visible pages; backgrounding never releases a saved slot. */
export function isBrowserSessionVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}
