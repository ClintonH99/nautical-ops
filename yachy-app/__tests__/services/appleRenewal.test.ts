import { appleRenewalStatus } from '../../supabase/functions/_shared/appleRenewal';
import { resolveSubscriptionAccess } from '../../src/services/subscription';
jest.mock('../../src/services/supabase', () => ({ supabase: {} }));

it('distinguishes active access from auto renewal and restores renewal when re-enabled', () => {
  expect(appleRenewalStatus(1, 0)).toBe('canceled');
  expect(appleRenewalStatus(1, 1)).toBe('active');
  expect(appleRenewalStatus(2, 0)).toBe('canceled');
  expect(appleRenewalStatus(5, 0)).toBe('revoked');
  expect(appleRenewalStatus(3, 0)).toBe('past_due');
  expect(appleRenewalStatus(4, 1)).toBe('past_due');
  expect(() => appleRenewalStatus(99, 0)).toThrow();
});

it('retains cancelled access until the exact Apple timestamp, not midnight or a grace extension', () => {
  const end = Date.parse('2026-10-01T14:00:00Z');
  const row = { status: appleRenewalStatus(1, 0), current_period_end: new Date(end).toISOString() };
  expect(resolveSubscriptionAccess(row, end - 1).state).toBe('entitled');
  expect(resolveSubscriptionAccess(row, end).state).toBe('payment_required');
});
