const mockRpc = jest.fn();

jest.mock('../../src/services/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import {
  getVesselSubscriptionAccess,
  resolveSubscriptionAccess,
} from '../../src/services/subscription';

const NOW = Date.parse('2026-09-03T12:00:00.000Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    vessel_id: 'vessel-1',
    plan_tier: '1_5',
    billing_period: 'monthly',
    status: 'active',
    current_period_start: '2026-08-01T12:00:00.000Z',
    current_period_end: '2026-09-10T12:00:00.000Z',
    grace_period_end: null,
    payment_provider: 'apple',
    created_at: '2026-08-01T12:00:00.000Z',
    updated_at: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('resolveSubscriptionAccess', () => {
  it('does not restrict a vessel that has never subscribed', () => {
    expect(resolveSubscriptionAccess(null, NOW).state).toBe('never_subscribed');
  });

  it('allows an active paid period', () => {
    expect(resolveSubscriptionAccess(row(), NOW).state).toBe('entitled');
  });

  it('preserves paid access after cancellation until the period ends', () => {
    expect(resolveSubscriptionAccess(row({ status: 'canceled' }), NOW).state).toBe('entitled');
  });

  it('removes access immediately after Apple confirms a refund or revocation', () => {
    expect(resolveSubscriptionAccess(row({ status: 'revoked' }), NOW).state).toBe(
      'payment_required'
    );
  });

  it('allows a failed renewal during the explicit grace period', () => {
    expect(
      resolveSubscriptionAccess(
        row({
          status: 'past_due',
          current_period_end: '2026-09-01T12:00:00.000Z',
          grace_period_end: '2026-09-17T12:00:00.000Z',
        }),
        NOW
      ).state
    ).toBe('grace_period');
  });

  it('restricts access after the explicit grace period ends', () => {
    expect(
      resolveSubscriptionAccess(
        row({
          status: 'past_due',
          current_period_end: '2026-08-18T11:59:59.000Z',
          grace_period_end: '2026-09-03T11:59:59.000Z',
        }),
        NOW
      ).state
    ).toBe('payment_required');
  });

  it('uses the 16-day fallback for legacy past-due rows', () => {
    expect(
      resolveSubscriptionAccess(
        row({ status: 'past_due', current_period_end: '2026-08-25T12:00:00.000Z' }),
        NOW
      ).state
    ).toBe('grace_period');
  });

  it('does not mistake an unrefreshed active Apple row for failed payment', () => {
    expect(
      resolveSubscriptionAccess(
        row({ status: 'active', current_period_end: '2026-08-01T12:00:00.000Z' }),
        NOW
      ).state
    ).toBe('unavailable');
  });

  it('does not grant a grace period to an expired canceled subscription', () => {
    expect(
      resolveSubscriptionAccess(
        row({ status: 'canceled', current_period_end: '2026-09-01T12:00:00.000Z' }),
        NOW
      ).state
    ).toBe('payment_required');
  });

  it('fails open as unavailable for malformed dates', () => {
    expect(resolveSubscriptionAccess(row({ current_period_end: 'not-a-date' }), NOW).state).toBe(
      'unavailable'
    );
  });
});

describe('getVesselSubscriptionAccess', () => {
  beforeEach(() => mockRpc.mockReset());

  it('loads only the safe server-side entitlement projection', async () => {
    mockRpc.mockResolvedValue({ data: [row()], error: null });

    const result = await getVesselSubscriptionAccess('vessel-1');

    expect(result.state).toBe('entitled');
    expect(mockRpc).toHaveBeenCalledWith('get_vessel_subscription_entitlement', {
      p_vessel_id: 'vessel-1',
    });
  });
});
