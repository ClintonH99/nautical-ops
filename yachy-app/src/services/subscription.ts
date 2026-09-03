/**
 * Subscription Service
 * Vessel subscription status from Supabase (vessel_subscriptions).
 */
import { supabase } from './supabase';
import type { PlanTierId, BillingPeriodId } from '../constants/subscriptionPlans';

export interface VesselSubscription {
  id: string;
  vesselId: string;
  planTier: PlanTierId;
  billingPeriod: BillingPeriodId;
  status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'revoked';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  gracePeriodEnd: string | null;
  paymentProvider: 'apple' | 'google' | 'legacy_paddle' | null;
  createdAt: string;
  updatedAt: string;
}

export type SubscriptionAccessState =
  | 'never_subscribed'
  | 'entitled'
  | 'grace_period'
  | 'payment_required'
  | 'unavailable';

export interface VesselSubscriptionAccess {
  state: SubscriptionAccessState;
  subscription: VesselSubscription | null;
}

export const SUBSCRIPTION_GRACE_DAYS = 16;

const mapSubscription = (data: any): VesselSubscription => ({
  id: data.id,
  vesselId: data.vessel_id,
  planTier: data.plan_tier as PlanTierId,
  billingPeriod: data.billing_period as BillingPeriodId,
  status: data.status,
  currentPeriodStart: data.current_period_start,
  currentPeriodEnd: data.current_period_end,
  gracePeriodEnd: data.grace_period_end ?? null,
  paymentProvider:
    data.payment_provider === 'apple' || data.payment_provider === 'google'
      ? data.payment_provider
      : data.payment_provider === 'paddle'
        ? 'legacy_paddle'
        : null,
  createdAt: data.created_at,
  updatedAt: data.updated_at,
});

export function resolveSubscriptionAccess(data: any, now = Date.now()): VesselSubscriptionAccess {
  if (!data) return { state: 'never_subscribed', subscription: null };

  const subscription = mapSubscription(data);
  const paidThrough = new Date(subscription.currentPeriodEnd).getTime();

  // A refund/revocation removes the entitlement immediately, regardless of
  // the original paid-through date.
  if (subscription.status === 'revoked') {
    return { state: 'payment_required', subscription };
  }

  if (!Number.isFinite(paidThrough)) {
    return { state: 'unavailable', subscription: null };
  }

  // A cancellation does not remove time the customer already paid for.
  if (paidThrough > now && subscription.status !== 'past_due') {
    return { state: 'entitled', subscription };
  }

  // Older Apple rows were not refreshed server-side at renewal. An expired
  // date on a row still marked active is therefore stale/unknown, not proof of
  // failed payment. Only a provider-confirmed state may lock somebody out.
  if (subscription.status === 'active' || subscription.status === 'trialing') {
    return { state: 'unavailable', subscription: null };
  }

  // Apple/Google should supply the real grace expiry. The 16-day fallback
  // supports existing subscription rows created before that field existed.
  const fallbackGraceEnd = paidThrough + SUBSCRIPTION_GRACE_DAYS * 24 * 60 * 60 * 1000;
  const explicitGraceEnd = subscription.gracePeriodEnd
    ? new Date(subscription.gracePeriodEnd).getTime()
    : Number.NaN;
  const graceEnd = Number.isFinite(explicitGraceEnd) ? explicitGraceEnd : fallbackGraceEnd;
  const renewalCanBeRecovered = subscription.status === 'past_due';

  if (renewalCanBeRecovered && graceEnd > now) {
    return { state: 'grace_period', subscription };
  }

  return { state: 'payment_required', subscription };
}

/**
 * Resolve whether a vessel is entitled to paid access.
 *
 * A missing row means the vessel has never subscribed, so it is deliberately
 * not treated as a failed renewal. Network/database failures return
 * `unavailable` and must never lock users out.
 */
export async function getVesselSubscriptionAccess(
  vesselId: string
): Promise<VesselSubscriptionAccess> {
  try {
    const { data, error } = await supabase.rpc('get_vessel_subscription_entitlement', {
      p_vessel_id: vesselId,
    });

    if (error) {
      if (__DEV__) console.warn('getVesselSubscriptionAccess error:', error);
      return { state: 'unavailable', subscription: null };
    }
    const safeRow = Array.isArray(data) ? data[0] : data;
    return resolveSubscriptionAccess(safeRow ?? null);
  } catch (err) {
    if (__DEV__) console.warn('getVesselSubscriptionAccess:', err);
    return { state: 'unavailable', subscription: null };
  }
}

/**
 * Get active or trialing subscription for a vessel.
 */
export async function getVesselSubscription(vesselId: string): Promise<VesselSubscription | null> {
  const access = await getVesselSubscriptionAccess(vesselId);
  return access.state === 'entitled' || access.state === 'grace_period'
    ? access.subscription
    : null;
}
