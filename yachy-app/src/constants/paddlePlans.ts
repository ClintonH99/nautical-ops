/** Approved web catalogue. USD totals, rounded once to cents for the whole billing period.
 * Percentages are calculation inputs only, never promotional labels in the UI.
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
  { id: 'monthly', label: 'Monthly', months: 1, payablePercent: 100, suffix: '/ month' },
  { id: '3_months', label: '3 Months', months: 3, payablePercent: 95, suffix: '/ 3 months' },
  { id: '6_months', label: '6 Months', months: 6, payablePercent: 92, suffix: '/ 6 months' },
  { id: '12_months', label: 'Yearly', months: 12, payablePercent: 90, suffix: '/ year' },
] as const;
export type PaddlePlanTier = (typeof PADDLE_PLAN_TIERS)[number]['id'];
export type PaddleBillingPeriod = (typeof PADDLE_BILLING_PERIODS)[number]['id'];
export function getPaddlePrice(tierId: PaddlePlanTier, periodId: PaddleBillingPeriod) {
  const tier = PADDLE_PLAN_TIERS.find((tier) => tier.id === tierId);
  const period = PADDLE_BILLING_PERIODS.find((period) => period.id === periodId);
  if (!tier || !period) throw new Error('Unknown plan or billing period');
  const totalCents = Math.round((tier.monthlyCents * period.months * period.payablePercent) / 100);
  return {
    totalCents,
    currency: 'USD' as const,
    displayTotal: `$${(totalCents / 100).toFixed(2)}`,
    suffix: period.suffix,
  };
}
