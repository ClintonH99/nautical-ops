import { supabase } from './supabase';
import type { PaddlePlanTier, PaddleBillingPeriod } from '../constants/paddlePlans';
import type { BillingLocation } from './paddlePricing';

export const paddleCheckoutEnabled = process.env.EXPO_PUBLIC_PADDLE_CHECKOUT_ENABLED === 'true';
export const paddleEnvironment = process.env.EXPO_PUBLIC_PADDLE_ENV;
export const paddleSandboxTrialsEnabled =
  paddleEnvironment === 'sandbox' &&
  process.env.EXPO_PUBLIC_PADDLE_SANDBOX_TRIAL_ENABLED === 'true';

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
    if (body?.error === 'Sandbox trials are not enabled.') {
      return 'Sandbox trial testing is temporarily unavailable. No live payment has been enabled.';
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
  if (!paddleSandboxTrialsEnabled) throw new Error('Sandbox trials are not yet available.');
  const { data, error } = await supabase.functions.invoke('start-paddle-trial', {
    body: { vesselId, planTier, billingPeriod, ...location },
  });
  if (error) throw new Error(await trialErrorMessage(error));
  if (data?.environment !== 'sandbox' || data?.state !== 'pending_confirmation')
    throw new Error(trialFailure);
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

export async function preparePaddlePaymentRecovery(
  vesselId: string,
  origin: string
): Promise<string> {
  if (!paddleSandboxTrialsEnabled)
    throw new Error('Sandbox payment recovery is not yet available.');
  const { data, error } = await supabase.functions.invoke('prepare-paddle-payment-recovery', {
    body: { vesselId },
  });
  if (error || data?.environment !== 'sandbox' || data?.purpose !== 'payment_recovery')
    throw new Error(
      'Payment recovery could not be confirmed. Refresh Plan Status before trying again. If this continues, contact support.'
    );
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
