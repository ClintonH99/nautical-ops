import { supabase } from './supabase';
import type { PaddlePlanTier, PaddleBillingPeriod } from '../constants/paddlePlans';
import type { BillingLocation } from './paddlePricing';

export const paddleCheckoutEnabled = process.env.EXPO_PUBLIC_PADDLE_CHECKOUT_ENABLED === 'true';
export const paddleEnvironment = process.env.EXPO_PUBLIC_PADDLE_ENV;
export const paddleSandboxTrialsEnabled =
  paddleEnvironment === 'sandbox' &&
  process.env.EXPO_PUBLIC_PADDLE_SANDBOX_TRIAL_ENABLED === 'true';

export async function startPaddleTrial(
  vesselId: string,
  planTier: PaddlePlanTier,
  billingPeriod: PaddleBillingPeriod,
  location: BillingLocation
): Promise<void> {
  if (!paddleSandboxTrialsEnabled) throw new Error('Sandbox trials are not yet available.');
  const { data, error } = await supabase.functions.invoke('start-paddle-trial', {
    body: { vesselId, planTier, billingPeriod, ...location },
  });
  if (error || data?.environment !== 'sandbox' || data?.state !== 'pending_confirmation')
    throw new Error(
      'Trial could not be confirmed. Refresh your plan before trying again. If this continues, contact support.'
    );
}

export async function preparePaddleTrialPayment(
  vesselId: string,
  origin: string,
  trialEnd: string
): Promise<string> {
  if (!paddleSandboxTrialsEnabled) throw new Error('Sandbox payment setup is not yet available.');
  const { data, error } = await supabase.functions.invoke('prepare-paddle-trial-payment', {
    body: { vesselId },
  });
  if (
    error ||
    data?.purpose !== 'trial_payment_method' ||
    !Number.isFinite(Date.parse(trialEnd)) ||
    Date.parse(data.trialEnd) !== Date.parse(trialEnd)
  )
    throw new Error('Payment setup could not be confirmed. Refresh your plan before trying again.');
  return validatedCheckoutUrl(data, origin);
}

export function validatedCheckoutUrl(data: unknown, origin: string): string {
  if (!data || typeof data !== 'object')
    throw new Error('The payment link could not be verified. Please contact support.');
  const result = data as Record<string, unknown>;
  if (
    !['sandbox', 'live'].includes(paddleEnvironment ?? '') ||
    result.environment !== paddleEnvironment
  )
    throw new Error('Payment configuration does not match. Please contact support.');
  if (typeof result.url !== 'string' || typeof result.transactionId !== 'string')
    throw new Error('The payment link could not be verified. Please contact support.');
  const url = new URL(result.url);
  if (
    !/^txn_[a-z0-9]{26}$/.test(result.transactionId) ||
    url.protocol !== 'https:' ||
    url.origin !== origin ||
    url.pathname !== '/checkout' ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.get('_ptxn') !== result.transactionId
  )
    throw new Error('The payment link could not be verified. Please contact support.');
  return url.href;
}

export async function preparePaddleCheckout(
  vesselId: string,
  planTier: PaddlePlanTier,
  billingPeriod: PaddleBillingPeriod,
  origin: string
): Promise<string> {
  if (!paddleCheckoutEnabled) throw new Error('Payments are not yet available.');
  const { data, error } = await supabase.functions.invoke('create-paddle-checkout', {
    body: { vesselId, planTier, billingPeriod },
  });
  if (error || !data?.url) {
    // A network error may have happened after Paddle created the checkout.
    // Never silently retry: the server must reconcile/reuse that intent.
    throw new Error(
      'Checkout could not be confirmed. Refresh your plan before trying again. If this continues, contact support.'
    );
  }
  return validatedCheckoutUrl(data, origin);
}
