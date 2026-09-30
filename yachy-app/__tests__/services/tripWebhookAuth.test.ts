/** @jest-environment node */
import { isTrustedNotificationRequest } from '../../supabase/functions/send-trip-push/internal-auth';

describe('trip webhook authorization', () => {
  it('accepts the dedicated server secret even when gateway authorization differs', () => {
    expect(isTrustedNotificationRequest(new Headers({ 'x-trip-webhook-secret': 'server-only', Authorization: 'Bearer gateway-jwt' }), 'service-key', 'server-only')).toBe(true);
  });
  it.each(['', 'wrong', 'server-onl', 'server-only-extra'])('rejects a wrong secret: %s', (secret) => {
    expect(isTrustedNotificationRequest(new Headers({ 'x-trip-webhook-secret': secret }), 'service-key', 'server-only')).toBe(false);
  });
  it('never accepts a user JWT or a missing configured key', () => {
    expect(isTrustedNotificationRequest(new Headers({ Authorization: 'Bearer user-jwt' }), 'service-key', 'server-only')).toBe(false);
    expect(isTrustedNotificationRequest(new Headers(), undefined, undefined)).toBe(false);
  });
  it('preserves existing trusted reminder requests', () => {
    expect(isTrustedNotificationRequest(new Headers({ Authorization: 'Bearer service-key' }), 'service-key', 'server-only')).toBe(true);
  });
});
