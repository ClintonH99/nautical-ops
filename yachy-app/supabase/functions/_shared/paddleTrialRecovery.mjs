import { BillingError, PaddleRequestError } from './paddle.mjs';

const DEFINITE_CREATE_REJECTIONS = new Set([
  'transaction_checkout_not_enabled',
  'transaction_checkout_url_domain_is_not_approved',
  'transaction_default_checkout_url_not_set',
  'transaction_creation_blocked',
  'invalid_field',
  'invalid_json',
]);
export function recoveryError(code, message, status = 409) {
  const error = new BillingError(message, status);
  error.recoveryCode = code;
  return error;
}
export function trialReservationError(error) {
  if (error?.message === 'Resolve the existing billing request first')
    return recoveryError(
      'trial_other_request_pending',
      'A previous request uses a different plan or billing period. Refresh Plan Status. If unchanged, contact support before starting another checkout.'
    );
  if (error?.message === 'Manage the existing subscription; a second trial is not allowed')
    return recoveryError(
      'trial_existing_subscription',
      'Your vessel already has billing history. Refresh Plan Status and manage the existing subscription; a second free trial cannot be started.'
    );
  if (error?.message === 'Captain/MOV membership and a registered device required')
    return recoveryError(
      'trial_access_required',
      'Sign in as the vessel Captain/MOV on a registered device before starting the trial.'
    );
  return recoveryError(
    'trial_reservation_unavailable',
    'Trial could not be reserved. Refresh Plan Status and contact support if the problem continues.'
  );
}
export async function recoverNewTrialFailure({
  error,
  stage,
  intent,
  admin,
  vesselId,
  userId,
  environment,
}) {
  // Never apply this to a replay, a pre-existing reservation, PATCH /transactions,
  // a timeout after POST, malformed success, or a failure saving the binding.
  let reason;
  if (stage === 'before_transaction_request') reason = stage;
  else if (
    stage === 'creating_transaction' &&
    error instanceof PaddleRequestError &&
    error.providerStatus === 400 &&
    DEFINITE_CREATE_REJECTIONS.has(error.providerCode)
  )
    reason = error.providerCode;
  if (!reason || intent?.created !== true)
    return recoveryError(
      'trial_confirmation_pending',
      'Paddle may have received your request. Refresh Plan Status. If unchanged, contact support before retrying so we can avoid a duplicate subscription.'
    );
  try {
    const { data, error: releaseError } = await admin.rpc('release_failed_paddle_trial', {
      p_intent_id: intent.id,
      p_vessel_id: vesselId,
      p_user_id: userId,
      p_environment: environment,
      p_reason: reason,
      p_request_id: error instanceof PaddleRequestError ? error.providerRequestId || null : null,
    });
    if (releaseError || data !== true) throw new Error('Release not confirmed');
  } catch {
    return recoveryError(
      'trial_recovery_pending',
      'The unsuccessful request still needs checking. Refresh Plan Status and contact support before retrying.'
    );
  }
  if (reason.startsWith('transaction_'))
    return recoveryError(
      'trial_checkout_unavailable',
      'Paddle could not create this checkout. No trial or payment was created by this request. Please contact support; the failed request will not block a fresh attempt once checkout is available.',
      503
    );
  return recoveryError(
    'trial_safe_to_retry',
    'The trial was not started and no payment was taken. Check your billing country and ZIP/postal code, then try again. If this continues, contact support.',
    503
  );
}
