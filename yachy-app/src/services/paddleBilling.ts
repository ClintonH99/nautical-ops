import { supabase } from './supabase';
import type { PaddlePlanTier, PaddleBillingPeriod } from '../constants/paddlePlans';
import type { BillingLocation } from './paddlePricing';

export const paddleEnvironment = process.env.EXPO_PUBLIC_PADDLE_ENV;
export const paddleCheckoutEnabled =
  process.env.EXPO_PUBLIC_PADDLE_CHECKOUT_ENABLED === 'true' &&
  (paddleEnvironment === 'sandbox' ||
    (paddleEnvironment === 'live' &&
      process.env.EXPO_PUBLIC_PADDLE_LIVE_BILLING_ENABLED === 'true'));
export const paddleSandboxTrialsEnabled =
  paddleEnvironment === 'sandbox' &&
  process.env.EXPO_PUBLIC_PADDLE_SANDBOX_TRIAL_ENABLED === 'true';
export const paddleBillingEnabled =
  paddleSandboxTrialsEnabled || (paddleEnvironment === 'live' && paddleCheckoutEnabled);
export const paddleManagementEnabled =
  paddleBillingEnabled && process.env.EXPO_PUBLIC_PADDLE_SUBSCRIPTION_MANAGEMENT_ENABLED === 'true';

const trialFailure =
  'Trial could not be confirmed. Refresh Plan Status before trying again. If this continues, contact support.';

async function trialErrorMessage(error: unknown): Promise<string> {
  // Supabase FunctionsHttpError carries the server response. Never display raw
  // provider diagnostics or assume a timeout means no transaction was created.
  try {
    const context = (error as { context?: Response } | null)?.context;
    if (!context || typeof context.clone !== 'function') return trialFailure;
    const body = await context.clone().json();
    if (context.status === 403 && body?.error === 'Sandbox testing is restricted.') {
      return 'This account is not authorised for sandbox subscription testing. Ask support to enable this test account; no trial was started by this request.';
    }
    if (context.status === 401)
      return 'Your session could not be verified. Sign in again before starting your trial.';
    if (context.status === 409) {
      return 'A trial could not be started because your vessel, device access or an existing billing request needs checking. Select Refresh Plan Status. If it remains unchanged, contact support before retrying.';
    }
    if (body?.error === 'Billing is not enabled for this environment.') {
      return 'Billing is temporarily unavailable. Please contact support.';
    }
  } catch {
    // A missing/unreadable response is ambiguous, not permission to retry.
  }
  return trialFailure;
}

export async function startPaddleTrial(
  vesselId: string,
  planTier: PaddlePlanTier,
  billingPeriod: PaddleBillingPeriod,
  location: BillingLocation
): Promise<void> {
  if (!paddleBillingEnabled) throw new Error('Trials are not yet available.');
  const { data, error } = await supabase.functions.invoke('start-paddle-trial', {
    body: { vesselId, planTier, billingPeriod, ...location },
  });
  if (error) throw new Error(await trialErrorMessage(error));
  if (data?.environment !== paddleEnvironment || data?.state !== 'pending_confirmation')
    throw new Error(trialFailure);
}

export async function preparePaddleTrialPayment(
  vesselId: string,
  origin: string,
  trialEnd: string,
  promoCode?: string
): Promise<string> {
  if (!paddleBillingEnabled) throw new Error('Payment setup is not yet available.');
  const { data, error } = await supabase.functions.invoke('prepare-paddle-trial-payment', {
    body: { vesselId, ...(promoCode?.trim() ? { promoCode: promoCode.trim() } : {}) },
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

export async function preparePaddlePaymentRecovery(
  vesselId: string,
  origin: string
): Promise<string> {
  if (!paddleBillingEnabled) throw new Error('Payment recovery is not yet available.');
  const { data, error } = await supabase.functions.invoke('prepare-paddle-payment-recovery', {
    body: { vesselId },
  });
  if (error || data?.environment !== paddleEnvironment || data?.purpose !== 'payment_recovery')
    throw new Error(
      'Payment recovery could not be confirmed. Refresh Plan Status before trying again. If this continues, contact support.'
    );
  return validatedCheckoutUrl(data, origin);
}

export type PaddleManagementStatus = {
  status: 'active' | 'trialing' | 'past_due';
  periodEnd: string;
  cancellationScheduled: boolean;
};

export async function preparePaddleReactivation(vesselId: string, origin: string): Promise<string> {
  if (!paddleBillingEnabled) throw new Error('Payments are not yet available.');
  const { data, error } = await supabase.functions.invoke('prepare-paddle-reactivation', {
    body: { vesselId },
  });
  if (error || data?.purpose !== 'paid_reactivation')
    throw new Error(
      'Payment could not be prepared. Refresh Plan Status. If this continues, contact support before retrying.'
    );
  return validatedCheckoutUrl(data, origin);
}

async function managementRequest(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!paddleManagementEnabled) throw new Error('Subscription management is not yet available.');
  const { data, error } = await supabase.functions.invoke('manage-paddle-subscription', { body });
  if (error || !data || data.environment !== paddleEnvironment)
    throw new Error(
      'Subscription action could not be confirmed. Refresh Plan Status before retrying.'
    );
  return data;
}

export async function getPaddleManagementStatus(vesselId: string): Promise<PaddleManagementStatus> {
  const data = await managementRequest({ vesselId, action: 'status' });
  if (
    !['active', 'trialing', 'past_due'].includes(String(data.status)) ||
    typeof data.periodEnd !== 'string' ||
    !Number.isFinite(Date.parse(data.periodEnd)) ||
    typeof data.cancellationScheduled !== 'boolean'
  )
    throw new Error('Subscription details could not be confirmed.');
  return data as PaddleManagementStatus;
}

export async function cancelPaddleRenewal(vesselId: string, periodEnd: string): Promise<void> {
  const data = await managementRequest({
    vesselId,
    action: 'cancel_renewal',
    confirm: true,
    periodEnd,
  });
  if (
    data.state !== 'pending_confirmation' ||
    typeof data.periodEnd !== 'string' ||
    !Number.isFinite(Date.parse(periodEnd)) ||
    Date.parse(data.periodEnd) !== Date.parse(periodEnd)
  )
    throw new Error('Cancellation could not be confirmed. Refresh Plan Status before retrying.');
}

export async function preparePaddlePaymentMethod(
  vesselId: string,
  origin: string
): Promise<string> {
  const data = await managementRequest({ vesselId, action: 'payment_method' });
  if (data.purpose !== 'payment_method') throw new Error('Payment setup could not be confirmed.');
  return validatedCheckoutUrl(data, origin);
}

export async function keepPaddleSubscription(vesselId: string, periodEnd: string): Promise<void> {
  const data = await managementRequest({
    vesselId,
    action: 'keep_subscription',
    confirm: true,
    periodEnd,
  });
  if (
    data.state !== 'pending_confirmation' ||
    typeof data.periodEnd !== 'string' ||
    !Number.isFinite(Date.parse(periodEnd)) ||
    Date.parse(data.periodEnd) !== Date.parse(periodEnd)
  )
    throw new Error('Renewal could not be confirmed. Refresh Plan Status before retrying.');
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
  const destination = new URL(origin);
  // Sandbox links use Paddle's configured canonical payment page. Keep the
  // verified transaction on this website/preview, preserving its return route.
  // Live checkout remains strictly same-origin.
  const canonicalSandboxLink =
    paddleEnvironment === 'sandbox' && url.origin === 'https://nautical-ops.vercel.app';
  if (
    !/^txn_[a-z0-9]{26}$/.test(result.transactionId) ||
    url.protocol !== 'https:' ||
    (url.origin !== origin && !canonicalSandboxLink) ||
    destination.origin !== origin ||
    destination.protocol !== 'https:' ||
    url.pathname !== '/checkout' ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.get('_ptxn') !== result.transactionId ||
    [...url.searchParams.keys()].length !== 1
  )
    throw new Error('The payment link could not be verified. Please contact support.');
  return new URL('/checkout?_ptxn=' + result.transactionId, destination.origin).href;
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
