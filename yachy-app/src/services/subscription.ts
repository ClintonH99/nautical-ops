/**
 * Subscription Service
 * Handles vessel subscription status and payment flows (Stripe, RevenueCat)
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

/**
 * Create Stripe Checkout session for selected plan.
 * Calls Edge Function; returns checkout URL to open in browser.
 */
export async function createStripeCheckout(
  vesselId: string,
  planTier: PlanTierId,
  billingPeriod: BillingPeriodId,
  successUrl: string,
  cancelUrl: string
): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: {
        vesselId,
        planTier,
        billingPeriod,
        successUrl,
        cancelUrl,
      },
    });

    if (error) {
      if (__DEV__) console.warn('createStripeCheckout error:', error);
      return null;
    }

    return data?.url ?? null;
  } catch (err) {
    if (__DEV__) console.warn('createStripeCheckout:', err);
    return null;
  }
}

const ENTITLEMENT_ID = 'vessel_subscription';

/**
 * Check RevenueCat entitlement (for in-app purchases).
 * Returns true if user has active vessel_subscription entitlement.
 */
export async function checkRevenueCatEntitlement(): Promise<boolean> {
  try {
    const Purchases = require('react-native-purchases').default;
    const customerInfo = await Purchases.getCustomerInfo();
    return !!customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
  } catch {
    return false;
  }
}

/**
 * Purchase a plan via RevenueCat (App Store / Play Store).
 *
 * RevenueCat Offering/Package identifiers must match the plan tier and billing
 * period IDs configured in the RevenueCat dashboard. The convention used here:
 *   offering:  planTierId  (e.g. "1_5", "6_10")
 *   package:   billingPeriodId (e.g. "monthly", "3_months")
 *
 * Returns true on success, false if cancelled, throws on error.
 */
export async function purchaseWithRevenueCat(
  planTier: PlanTierId,
  billingPeriod: BillingPeriodId
): Promise<boolean> {
  try {
    const Purchases = require('react-native-purchases').default;

    // Fetch all offerings from RevenueCat
    const offerings = await Purchases.getOfferings();

    // Look for an offering whose identifier matches the plan tier
    const offering = offerings.all?.[planTier] ?? offerings.current;
    if (!offering) {
      throw new Error(
        `No RevenueCat offering found for plan tier "${planTier}". ` +
          'Ensure offerings are configured in the RevenueCat dashboard.'
      );
    }

    // Find the package matching the billing period
    const pkg = offering.availablePackages?.find(
      (p: any) => p.identifier === billingPeriod || p.packageType === billingPeriod.toUpperCase()
    );
    if (!pkg) {
      throw new Error(
        `No RevenueCat package found for billing period "${billingPeriod}" ` +
          `in offering "${planTier}".`
      );
    }

    const { customerInfo } = await Purchases.purchasePackage(pkg);

    // Return true if the entitlement is now active
    return !!customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
  } catch (err: any) {
    // userCancelledPurchase is not an error — return false silently
    if (err?.userCancelled === true) return false;
    if (__DEV__) console.warn('purchaseWithRevenueCat error:', err);
    throw err;
  }
}
