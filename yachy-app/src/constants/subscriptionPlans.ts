/**
 * Subscription plan tiers and billing periods for vessel plans.
 * Captain pays before accessing invite code; crew joins under captain's membership.
 */

export const PLAN_TIERS = [
  { id: '1_5', label: '1-5 Crew Members', maxCrew: 5, monthlyPrice: 79.99 },
  { id: '6_10', label: '6-10 Crew Members', maxCrew: 10, monthlyPrice: 89.99 },
  { id: '11_15', label: '11-15 Crew Members', maxCrew: 15, monthlyPrice: 119.99 },
  { id: '16_25', label: '16-25 Crew Members', maxCrew: 25, monthlyPrice: 149.99 },
  { id: '26_40', label: '26-40 Crew Members', maxCrew: 40, monthlyPrice: 199.99 },
  { id: '40_plus', label: '40+ Crew Members', maxCrew: Infinity, monthlyPrice: 249.99 },
] as const;

export type PlanTierId = (typeof PLAN_TIERS)[number]['id'];

export const BILLING_PERIODS = [
  { id: 'monthly', label: 'Monthly', months: 1, discountPercent: 0, isRecurring: true },
  { id: '3_months', label: '3 Months', months: 3, discountPercent: 5, isRecurring: true },
  { id: '6_months', label: '6 Months', months: 6, discountPercent: 8, isRecurring: true },
  { id: '12_months', label: 'Yearly', months: 12, discountPercent: 10, isRecurring: true },
  { id: 'once_off', label: 'Once-off', months: 12, discountPercent: 10, isRecurring: false },
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
 * Get price for a plan tier and billing period.
 * Discount applies: 3 months = 5%, 6 months = 8%, 12 months = 10%.
 */
export function getPrice(planTierId: PlanTierId, billingPeriodId: BillingPeriodId): PriceResult {
  const plan = PLAN_TIERS.find((p) => p.id === planTierId);
  const period = BILLING_PERIODS.find((p) => p.id === billingPeriodId);
  if (!plan || !period) {
    return {
      monthlyPrice: 0,
      discountedMonthly: 0,
      totalPrice: 0,
      displayMonthly: '$0',
      displayTotal: '$0',
      savingsPercent: 0,
    };
  }

  const monthlyPrice = plan.monthlyPrice;
  const discountMultiplier = 1 - period.discountPercent / 100;
  const discountedMonthly = monthlyPrice * discountMultiplier;
  const totalPrice = discountedMonthly * period.months;

  return {
    monthlyPrice,
    discountedMonthly,
    totalPrice,
    displayMonthly: `$${discountedMonthly.toFixed(2)}/mo`,
    displayTotal: `$${totalPrice.toFixed(2)}`,
    savingsPercent: period.discountPercent,
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
