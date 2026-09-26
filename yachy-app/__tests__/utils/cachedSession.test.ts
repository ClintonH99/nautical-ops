/** @jest-environment node */
import { getRenewableSessionUserId } from '../../src/utils/cachedSession';

it('retains a renewable session after a week away', () => {
  expect(
    getRenewableSessionUserId(
      JSON.stringify({
        access_token: 'expired',
        refresh_token: 'renewable',
        expires_at: Date.now() / 1000 - 7 * 86400,
        user: { id: 'crew' },
      })
    )
  ).toBe('crew');
});
it('rejects absent, malformed and unrenewable sessions', () => {
  for (const raw of [
    null,
    '{',
    '{}',
    JSON.stringify({ access_token: 'token', user: { id: 'crew' } }),
  ]) {
    expect(getRenewableSessionUserId(raw)).toBeNull();
  }
});
