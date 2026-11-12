import { supabase } from './supabase';
import {
  PADDLE_PLAN_TIERS,
  getPaddlePrice,
  type PaddlePlanTier,
  type PaddleBillingPeriod,
} from '../constants/paddlePlans';
import { paddleEnvironment } from './paddleBilling';

export interface BillingLocation {
  countryCode: string;
  postalCode: string;
}
export interface PaddleTaxQuote {
  tier: PaddlePlanTier;
  baseCents: number;
  taxCents: number;
  totalCents: number;
}
export interface PaddlePricePreview extends BillingLocation {
  billingPeriod: PaddleBillingPeriod;
  currency: 'USD';
  quotes: PaddleTaxQuote[];
}
export interface PaddlePromoPreview extends BillingLocation {
  billingPeriod: PaddleBillingPeriod;
  currency: 'USD';
  trialEnd: string;
  expiresAt: string;
  promo: { code: string; recur: boolean; maximumRecurringIntervals: number | null };
  quote: PaddleTaxQuote & { discountCents: number };
}
export const usd = (cents: number) => `US$${(cents / 100).toFixed(2)}`;

export function validatePricePreview(
  data: any,
  period: PaddleBillingPeriod,
  location: BillingLocation
): PaddlePricePreview {
  if (
    !data ||
    !['sandbox', 'live'].includes(paddleEnvironment ?? '') ||
    data.environment !== paddleEnvironment ||
    data.currency !== 'USD' ||
    data.billingPeriod !== period ||
    data.countryCode !== location.countryCode ||
    data.postalCode !== location.postalCode.trim() ||
    !Array.isArray(data.quotes) ||
    data.quotes.length !== PADDLE_PLAN_TIERS.length
  )
    throw new Error('The regional tax totals could not be verified. Please try again.');
  for (const tier of PADDLE_PLAN_TIERS) {
    const matches = data.quotes.filter((q: PaddleTaxQuote) => q?.tier === tier.id);
    const q = matches[0];
    if (
      matches.length !== 1 ||
      ![q.baseCents, q.taxCents, q.totalCents].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      q.baseCents !== getPaddlePrice(tier.id, period).totalCents ||
      q.totalCents !== q.baseCents + q.taxCents
    )
      throw new Error('The regional tax totals could not be verified. Please try again.');
  }
  return data;
}

export async function previewPaddlePrices(
  vesselId: string,
  period: PaddleBillingPeriod,
  location: BillingLocation
): Promise<PaddlePricePreview> {
  const { data, error } = await supabase.functions.invoke('preview-paddle-prices', {
    body: {
      vesselId,
      billingPeriod: period,
      countryCode: location.countryCode,
      postalCode: location.postalCode.trim(),
    },
  });
  if (error || data?.error)
    throw new Error(
      'Regional tax totals are unavailable. Please retry; checkout is paused until they can be confirmed.'
    );
  return validatePricePreview(data, period, location);
}

export function validatePromoPreview(
  data: any,
  tier: PaddlePlanTier,
  period: PaddleBillingPeriod,
  location: BillingLocation,
  code: string,
  trialEnd: string,
  now = Date.now()
): PaddlePromoPreview {
  const q = data?.quote;
  const promo = data?.promo;
  if (
    !data ||
    !['sandbox', 'live'].includes(paddleEnvironment ?? '') ||
    data.environment !== paddleEnvironment ||
    data.currency !== 'USD' ||
    data.billingPeriod !== period ||
    data.countryCode !== location.countryCode ||
    data.postalCode !== location.postalCode.trim() ||
    !Number.isFinite(Date.parse(data.trialEnd)) ||
    Date.parse(data.trialEnd) !== Date.parse(trialEnd) ||
    Date.parse(data.trialEnd) <= now ||
    !Number.isFinite(Date.parse(data.expiresAt)) ||
    Date.parse(data.expiresAt) <= now ||
    Date.parse(data.expiresAt) > now + 5 * 60 * 1000 ||
    typeof promo?.code !== 'string' ||
    promo.code.toLowerCase() !== code.trim().toLowerCase() ||
    typeof promo.recur !== 'boolean' ||
    (promo.maximumRecurringIntervals !== null &&
      (!Number.isSafeInteger(promo.maximumRecurringIntervals) ||
        promo.maximumRecurringIntervals < 1)) ||
    !q ||
    q.tier !== tier ||
    ![q.baseCents, q.discountCents, q.taxCents, q.totalCents].every(
      (n) => Number.isSafeInteger(n) && n >= 0
    ) ||
    q.baseCents !== getPaddlePrice(tier, period).totalCents ||
    q.discountCents <= 0 ||
    q.discountCents > q.baseCents ||
    q.totalCents !== q.baseCents - q.discountCents + q.taxCents
  )
    throw new Error('The discounted total could not be verified. Apply the code again.');
  return data;
}

export async function previewPaddlePromo(
  vesselId: string,
  tier: PaddlePlanTier,
  period: PaddleBillingPeriod,
  location: BillingLocation,
  code: string,
  trialEnd: string
): Promise<PaddlePromoPreview> {
  const { data, error } = await supabase.functions.invoke('preview-paddle-prices', {
    body: {
      vesselId,
      tier,
      billingPeriod: period,
      countryCode: location.countryCode,
      postalCode: location.postalCode.trim(),
      promoCode: code.trim(),
      trialEnd,
    },
  });
  if (error || data?.error) {
    // Function errors may carry a JSON Response. Surface only server-owned,
    // expected billing messages; never stringify a raw transport exception.
    let message = data?.error;
    if (!message && typeof Response !== 'undefined' && error?.context instanceof Response) {
      try {
        message = (await error.context.clone().json()).error;
      } catch {
        /* generic below */
      }
    }
    const allowed = [
      'Enter a valid promo code.',
      'This promo code is unavailable for this plan. No payment was taken.',
      'A promotion is already attached to this trial. Contact support before changing it.',
      'Refresh your current trial before checking a promo code.',
      'The trial has changed. Refresh your plan before checking the code.',
    ];
    throw new Error(
      allowed.includes(message) ? message : 'The promo code could not be checked. Please try again.'
    );
  }
  return validatePromoPreview(data, tier, period, location, code, trialEnd);
}
