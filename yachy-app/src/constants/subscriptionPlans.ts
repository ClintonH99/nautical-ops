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
] as const;

export const PLAN_BOARD_SMALL_MEDIUM: PlanTierId[] = ['1_5', '6_10', '11_15'];
export const PLAN_BOARD_MEDIUM_LARGE: PlanTierId[] = ['16_25', '26_40', '40_plus'];

export type BillingPeriodId = (typeof BILLING_PERIODS)[number]['id'];

/**
 * Paddle Billing price IDs (sandbox or live catalog).
 * Map: plan tier x billing period -> pri_*
 */
export const PADDLE_PRICE_IDS: Record<PlanTierId, Record<BillingPeriodId, string>> = {
  '1_5': {
    monthly: 'pri_01kmbephg7qqmbqvjck7zymssh',
    '3_months': 'pri_01kmbf0w42q58zngqdcccge9th',
    '6_months': 'pri_01kmbf1wrbe30gmhgb9g2pyg16',
    '12_months': 'pri_01kmbf5fq7jd2p0cx8j0xhakay',
  },
  '6_10': {
    monthly: 'pri_01kmber39aaqmmz1m6qbzq7yss',
    '3_months': 'pri_01kmbf9ej19e1f7h506ts5d73p',
    '6_months': 'pri_01kmbfabqx4q0654x9kwdh1pr9',
    '12_months': 'pri_01kmbfb5egpnskb5ecjv6xh77z',
  },
  '11_15': {
    monthly: 'pri_01kmbes0mbznxs11we7n8b9e5j',
    '3_months': 'pri_01kmbfcgm1y8kz52f18281ffrz',
    '6_months': 'pri_01kmbfdeyvk39w808zdv757rbx',
    '12_months': 'pri_01kmbfe65782vt1tdfgmhrpeww',
  },
  '16_25': {
    monthly: 'pri_01kmbet1wkq596zqe2y0cn8d20',
    '3_months': 'pri_01kmbff8h99yc7n0pk5che3bva',
    '6_months': 'pri_01kmbfg15wmgfsktswqhnkgw15',
    '12_months': 'pri_01kmbfgx5grpk10pt0awwjajhp',
  },
  '26_40': {
    monthly: 'pri_01kmbetrmtjw5jfefraw26yjee',
    '3_months': 'pri_01kmbfj17safnjk15v03anpqce',
    '6_months': 'pri_01kmbfk0f8smv3p048y5b7sm9f',
    '12_months': 'pri_01kmbfm2e3y1f27zn2e2c9c9xq',
  },
  '40_plus': {
    monthly: 'pri_01kmbevmd6a5hzdsf6pqmmx8rp',
    '3_months': 'pri_01kmbfn7etz89caxm9cj94tbmq',
    '6_months': 'pri_01kmbfp7sxramn43pg6cdzmsvq',
    '12_months': 'pri_01kmbfq0k4eg5fgensecty5d45',
  },
};

export function getPaddlePriceId(planTierId: PlanTierId, billingPeriodId: BillingPeriodId): string {
  const id = PADDLE_PRICE_IDS[planTierId]?.[billingPeriodId];
  if (!id) {
    throw new Error(`No Paddle price for tier ${planTierId} period ${billingPeriodId}`);
  }
  return id;
}

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
