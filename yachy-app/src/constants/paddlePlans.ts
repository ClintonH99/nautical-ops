/** Exact Paddle live catalogue totals, verified and approved on 29 October 2026.
 * Do not derive multi-month prices from a percentage discount.
 * Checkout must match these amounts to verified Paddle price IDs before it is enabled.
 */
export const PADDLE_PLAN_TIERS = [
  { id: '1_5', label: '1–5 Crew Members', maxCrew: 5, monthlyCents: 7999 },
  { id: '6_10', label: '6–10 Crew Members', maxCrew: 10, monthlyCents: 8999 },
  { id: '11_15', label: '11–15 Crew Members', maxCrew: 15, monthlyCents: 11999 },
  { id: '16_25', label: '16–25 Crew Members', maxCrew: 25, monthlyCents: 14999 },
  { id: '26_40', label: '26–40 Crew Members', maxCrew: 40, monthlyCents: 19999 },
  { id: '40_plus', label: '40+ Crew Members', maxCrew: Infinity, monthlyCents: 24999 },
] as const;
export const PADDLE_BILLING_PERIODS = [
  { id: 'monthly', label: 'Monthly', months: 1, suffix: '/ month' },
  { id: '3_months', label: '3 Months', months: 3, suffix: '/ 3 months' },
  { id: '6_months', label: '6 Months', months: 6, suffix: '/ 6 months' },
  { id: '12_months', label: 'Yearly', months: 12, suffix: '/ year' },
] as const;
export type PaddlePlanTier = (typeof PADDLE_PLAN_TIERS)[number]['id'];
export type PaddleBillingPeriod = (typeof PADDLE_BILLING_PERIODS)[number]['id'];
export const PADDLE_PRICE_CENTS: Record<PaddlePlanTier, Record<PaddleBillingPeriod, number>> = {
  '1_5': { monthly: 7999, '3_months': 22999, '6_months': 44999, '12_months': 86999 },
  '6_10': { monthly: 8999, '3_months': 25999, '6_months': 49999, '12_months': 97999 },
  '11_15': { monthly: 11999, '3_months': 34999, '6_months': 66999, '12_months': 129999 },
  '16_25': { monthly: 14999, '3_months': 42999, '6_months': 82999, '12_months': 161999 },
  '26_40': { monthly: 19999, '3_months': 56999, '6_months': 110999, '12_months': 215999 },
  '40_plus': { monthly: 24999, '3_months': 71999, '6_months': 137999, '12_months': 269999 },
};
export function getPaddlePrice(tierId: PaddlePlanTier, periodId: PaddleBillingPeriod) {
  const tier = PADDLE_PLAN_TIERS.find((tier) => tier.id === tierId);
  const period = PADDLE_BILLING_PERIODS.find((period) => period.id === periodId);
  if (!tier || !period) throw new Error('Unknown plan or billing period');
  const totalCents = PADDLE_PRICE_CENTS[tier.id][period.id];
  return {
    totalCents,
    currency: 'USD' as const,
    displayTotal: `$${(totalCents / 100).toFixed(2)}`,
    suffix: period.suffix,
  };
}
