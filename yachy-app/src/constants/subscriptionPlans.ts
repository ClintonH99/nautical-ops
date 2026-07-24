/**
 * Subscription plan tiers and billing periods for vessel plans.
 * Captain pays before accessing invite code; crew joins under captain's membership.
 * All purchases are processed through Apple In-App Purchase.
 */

export const PLAN_TIERS = [
  { id: '1_5', label: '1-5 Crew Members', maxCrew: 5, monthlyPrice: 79.99 },
  { id: '6_10', label: '6-10 Crew Members', maxCrew: 10, monthlyPrice: 89.99 },
  { id: '11_15', label: '11-15 Crew Members', maxCrew: 15, monthlyPrice: 119.00 },
  { id: '16_25', label: '16-25 Crew Members', maxCrew: 25, monthlyPrice: 149.99 },
  { id: '26_40', label: '26-40 Crew Members', maxCrew: 40, monthlyPrice: 199.99 },
  { id: '40_plus', label: '40+ Crew Members', maxCrew: Infinity, monthlyPrice: 249.99 },
] as const;

export type PlanTierId = (typeof PLAN_TIERS)[number]['id'];

export const BILLING_PERIODS = [
  { id: 'monthly', label: 'Monthly', months: 1, discountPercent: 0, isRecurring: true },
  { id: '3_months', label: '3 Months', months: 3, discountPercent: 0, isRecurring: true },
  { id: '6_months', label: '6 Months', months: 6, discountPercent: 0, isRecurring: true },
  { id: '12_months', label: 'Yearly', months: 12, discountPercent: 0, isRecurring: true },
] as const;

export const PLAN_BOARD_SMALL_MEDIUM: PlanTierId[] = ['1_5', '6_10', '11_15'];
export const PLAN_BOARD_MEDIUM_LARGE: PlanTierId[] = ['16_25', '26_40', '40_plus'];

export type BillingPeriodId = (typeof BILLING_PERIODS)[number]['id'];

export interface PriceResult {
  monthlyPrice: number;
  discountedMonthly: number;
  totalPrice: number;
  displayMonthly: string;
  displayTotal: string;
  savingsPercent: number;
}

/**
 * Apple IAP prices — exact amounts from App Store Connect price tiers.
 */
export const APPLE_PRICES: Record<PlanTierId, Partial<Record<BillingPeriodId, number>>> = {
  '1_5':    { monthly: 79.99,  '3_months': 229.00,  '6_months': 439.00,  '12_months': 859.00  },
  '6_10':   { monthly: 89.99,  '3_months': 249.00,  '6_months': 494.99,  '12_months': 969.00  },
  '11_15':  { monthly: 119.00, '3_months': 339.00,  '6_months': 659.00  },
  '16_25':  { monthly: 149.99, '3_months': 424.99,  '6_months': 829.00  },
  '26_40':  { monthly: 199.99, '3_months': 569.99  },
  '40_plus':{ monthly: 249.99, '3_months': 709.99  },
};

/**
 * Get price for a plan tier and billing period using exact Apple IAP prices.
 */
export function getPrice(planTierId: PlanTierId, billingPeriodId: BillingPeriodId): PriceResult {
  const applePrice = APPLE_PRICES[planTierId]?.[billingPeriodId];
  const plan = PLAN_TIERS.find((p) => p.id === planTierId);
  if (!plan || applePrice === undefined) {
    return {
      monthlyPrice: 0,
      discountedMonthly: 0,
      totalPrice: 0,
      displayMonthly: '$0',
      displayTotal: '$0',
      savingsPercent: 0,
    };
  }
  const periodLabels: Record<string, string> = {
    monthly: '/ month',
    '3_months': '/ 3 months',
    '6_months': '/ 6 months',
    '12_months': '/ year',
  };
  const periodLabel = periodLabels[billingPeriodId] ?? '/ month';
  return {
    monthlyPrice: applePrice,
    discountedMonthly: applePrice,
    totalPrice: applePrice,
    displayMonthly: `$${applePrice.toFixed(2)} ${periodLabel}`,
    displayTotal: `$${applePrice.toFixed(2)}`,
    savingsPercent: 0,
  };
}

/**
 * Get plan tier by ID.
 */
export function getPlanTier(planTierId: PlanTierId) {
  return PLAN_TIERS.find((p) => p.id === planTierId);
}

/**
 * Get billing period by ID.
 */
export function getBillingPeriod(billingPeriodId: BillingPeriodId) {
  return BILLING_PERIODS.find((p) => p.id === billingPeriodId);
}

/**
 * Apple App Store product IDs.
 * Map: plan tier x billing period -> com.nauticalops.app.*
 * Note: 6-month and 12-month plans for 26-40 and 40+ crew tiers
 * and 12-month plans for 11-15 and 16-25 crew tiers exceed Apple's
 * $999.99 maximum price tier and are not available via IAP.
 */
export const APPLE_PRODUCT_IDS: Record<PlanTierId, Partial<Record<BillingPeriodId, string>>> = {
  '1_5': {
    monthly: 'com.nauticalops.app.crew_1_5_v2.monthly',
    '3_months': 'com.nauticalops.app.crew_1_5_v2.3months',
    '6_months': 'com.nauticalops.app.crew_1_5_v2.6months',
    '12_months': 'com.nauticalops.app.crew_1_5_v2.12months',
  },
  '6_10': {
    monthly: 'com.nauticalops.app.crew_6_10_v2.monthly',
    '3_months': 'com.nauticalops.app.crew_6_10_v2.3months',
    '6_months': 'com.nauticalops.app.crew_6_10_v2.6months',
    '12_months': 'com.nauticalops.app.crew_6_10_v2.12months',
  },
  '11_15': {
    monthly: 'com.nauticalops.app.crew_11_15_v2.monthly',
    '3_months': 'com.nauticalops.app.crew_11_15_v2.3months',
    '6_months': 'com.nauticalops.app.crew_11_15_v2.6months',
  },
  '16_25': {
    monthly: 'com.nauticalops.app.crew_16_25_v2.monthly',
    '3_months': 'com.nauticalops.app.crew_16_25_v2.3months',
    '6_months': 'com.nauticalops.app.crew_16_25_v2.6months',
  },
  '26_40': {
    monthly: 'com.nauticalops.app.crew_26_40_v2.monthly',
    '3_months': 'com.nauticalops.app.crew_26_40_v2.3months',
  },
  '40_plus': {
    monthly: 'com.nauticalops.app.crew_40_plus_v2.monthly',
    '3_months': 'com.nauticalops.app.crew_40_plus_v2.3months',
  },
};

/**
 * Check if a plan tier and billing period is available via Apple IAP.
 */
export function isAvailableViaIAP(planTierId: PlanTierId, billingPeriodId: BillingPeriodId): boolean {
  return !!APPLE_PRODUCT_IDS[planTierId]?.[billingPeriodId];
}

/**
 * Get Apple Product ID for a plan tier and billing period.
 * Returns null if not available via IAP.
 */
export function getAppleProductId(planTierId: PlanTierId, billingPeriodId: BillingPeriodId): string | null {
  return APPLE_PRODUCT_IDS[planTierId]?.[billingPeriodId] ?? null;
}

/**
 * Get all Apple Product IDs as a flat array (used to fetch products from the store).
 */
export function getAllAppleProductIds(): string[] {
  return Object.values(APPLE_PRODUCT_IDS).flatMap((periods) => Object.values(periods as Record<string, string>));
}

/**
 * Reverse lookup: given an Apple Product ID, return the plan tier and billing period.
 */
export function getPlanFromAppleProductId(productId: string): { planTierId: PlanTierId; billingPeriodId: BillingPeriodId } | null {
  for (const [tierId, periods] of Object.entries(APPLE_PRODUCT_IDS)) {
    for (const [periodId, appleId] of Object.entries(periods as Record<string, string>)) {
      if (appleId === productId) {
        return {
          planTierId: tierId as PlanTierId,
          billingPeriodId: periodId as BillingPeriodId,
        };
      }
    }
  }
  return null;
}
