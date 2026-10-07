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
