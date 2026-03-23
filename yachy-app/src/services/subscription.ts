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
  status: 'active' | 'past_due' | 'canceled' | 'trialing';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get active subscription for a vessel.
 * Returns the subscription if status is 'active' and current_period_end > now.
 */
export async function getVesselSubscription(vesselId: string): Promise<VesselSubscription | null> {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('vessel_subscriptions')
      .select('*')
      .eq('vessel_id', vesselId)
      .eq('status', 'active')
      .gt('current_period_end', now)
      .order('current_period_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (__DEV__) console.warn('getVesselSubscription error:', error);
      return null;
    }

    if (!data) return null;

    return {
      id: data.id,
      vesselId: data.vessel_id,
      planTier: data.plan_tier as PlanTierId,
      billingPeriod: data.billing_period as BillingPeriodId,
      status: data.status,
      currentPeriodStart: data.current_period_start,
      currentPeriodEnd: data.current_period_end,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  } catch (err) {
    if (__DEV__) console.warn('getVesselSubscription:', err);
    return null;
  }
}
