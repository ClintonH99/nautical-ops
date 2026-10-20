import { BillingError } from './paddle.mjs';

// Live is opt-in twice. Neither deploying this code nor enabling the existing
// checkout flag is sufficient. Sandbox keeps its existing tester allowlist.
export function requirePaddleBilling(getEnv) {
  const environment = getEnv('PADDLE_ENV');
  if (environment === 'sandbox' && getEnv('PADDLE_SANDBOX_TRIAL_ENABLED') === 'true')
    return environment;
  if (
    environment === 'live' &&
    getEnv('PADDLE_LIVE_BILLING_ENABLED') === 'true' &&
    getEnv('PADDLE_CHECKOUT_ENABLED') === 'true'
  )
    return environment;
  throw new BillingError('Billing is not enabled for this environment.', 503);
}

export function requirePaddleTester(getEnv, userId) {
  if (
    getEnv('PADDLE_ENV') === 'sandbox' &&
    !(getEnv('PADDLE_SANDBOX_TEST_USER_IDS') || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .includes(userId)
  )
    throw new BillingError('Sandbox testing is restricted.', 403);
}

// Preserve compatibility with the deployed sandbox RPCs. The live path requires
// the additive production-readiness migration and never falls back to sandbox.
export function billingEnvironmentArgs(environment) {
  return environment === 'live' ? { p_environment: 'live' } : {};
}
