import { getTrialBillingReminder } from '../../src/utils/trialBillingReminder';
import type { VesselSubscriptionAccess } from '../../src/services/subscription';

const now = Date.parse('2026-10-07T12:00:00Z');
const day = 86400000;
const access: VesselSubscriptionAccess = {
  state: 'entitled',
  subscription: {
    id: 'trial',
    vesselId: 'vessel',
    planTier: '1_5',
    billingPeriod: 'monthly',
    status: 'trialing',
    paymentProvider: 'legacy_paddle',
    currentPeriodStart: new Date(now - 16 * day).toISOString(),
    currentPeriodEnd: new Date(now + 14 * day).toISOString(),
    gracePeriodEnd: null,
    createdAt: '',
    updatedAt: '',
  },
};
const get = (value = access, role = 'CAPTAIN_MOV', at = now) =>
  getTrialBillingReminder(value, 'user', 'vessel', role, at);

test('starts at exactly fourteen days remaining, not earlier; never extends access', () => {
  expect(get(access, 'CAPTAIN_MOV', now - 1)).toBeNull();
  expect(get()?.daysRemaining).toBe(14);
  expect(get(access, 'CAPTAIN_MOV', now + 13.5 * day)?.daysRemaining).toBe(1);
  expect(get(access, 'CAPTAIN_MOV', now + 14 * day)).toBeNull();
  expect(get()?.endsAt).toBe(access.subscription?.currentPeriodEnd);
});

test.each(['CREW', 'HOD', '', 'CAPTAIN'])('does not prompt role %s', (role) => {
  expect(get(access, role)).toBeNull();
});

test('does not interpret missing, stale, unavailable or non-trial billing as a reminder', () => {
  expect(get({ state: 'never_subscribed', subscription: null })).toBeNull();
  expect(get({ ...access, state: 'unavailable' })).toBeNull();
  const base = access.subscription!;
  for (const patch of [
    { vesselId: 'other' },
    { status: 'active' as const },
    { status: 'canceled' as const },
    { paymentProvider: 'apple' as const },
    { paymentProvider: null },
    { currentPeriodEnd: 'invalid' },
    { currentPeriodStart: 'invalid' },
    { currentPeriodStart: new Date(now + day).toISOString() },
  ])
    expect(get({ ...access, subscription: { ...base, ...patch } })).toBeNull();
});

test('dismissal keys are isolated by account, vessel and trial', () => {
  const key = get()?.key;
  expect(getTrialBillingReminder(access, 'other-user', 'vessel', 'CAPTAIN_MOV', now)?.key).not.toBe(
    key
  );
  expect(
    get({ ...access, subscription: { ...access.subscription!, id: 'new-trial' } })?.key
  ).not.toBe(key);
  expect(
    getTrialBillingReminder(
      { ...access, subscription: { ...access.subscription!, vesselId: 'other' } },
      'user',
      'other',
      'CAPTAIN_MOV',
      now
    )?.key
  ).not.toBe(key);
});
