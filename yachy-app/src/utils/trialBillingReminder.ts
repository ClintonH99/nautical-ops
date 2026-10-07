import type { VesselSubscriptionAccess } from '../services/subscription';

const DAY_MS = 24 * 60 * 60 * 1000;
export const TRIAL_BILLING_REMINDER_DAYS = 14;

export interface TrialBillingReminder {
  key: string;
  endsAt: string;
  daysRemaining: number;
}

/** A reminder only: never grants access, changes a trial date or starts payment. */
export function getTrialBillingReminder(
  access: VesselSubscriptionAccess,
  userId: string,
  vesselId: string,
  role: string,
  now = Date.now()
): TrialBillingReminder | null {
  const subscription = access.subscription;
  if (
    role !== 'CAPTAIN_MOV' ||
    !userId ||
    !vesselId ||
    access.state !== 'entitled' ||
    !subscription ||
    subscription.vesselId !== vesselId ||
    subscription.paymentProvider !== 'legacy_paddle' ||
    subscription.status !== 'trialing'
  )
    return null;

  const end = Date.parse(subscription.currentPeriodEnd);
  const start = Date.parse(subscription.currentPeriodStart);
  const remaining = end - now;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(now) ||
    start > now ||
    end <= start ||
    remaining <= 0 ||
    remaining > TRIAL_BILLING_REMINDER_DAYS * DAY_MS
  )
    return null;

  return {
    // Dismissal is specific to this account, vessel and trial, never global.
    key: `trial_billing_reminder:${userId}:${vesselId}:${subscription.id}:${end}`,
    endsAt: subscription.currentPeriodEnd,
    daysRemaining: Math.ceil(remaining / DAY_MS),
  };
}
