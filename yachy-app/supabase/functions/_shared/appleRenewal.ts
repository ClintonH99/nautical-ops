/** Values must come from Apple's authenticated subscription-status response. */
export function appleRenewalStatus(appleStatus: number, autoRenewStatus: unknown) {
  if (appleStatus === 1) return autoRenewStatus === 0 ? 'canceled' : 'active';
  if (appleStatus === 3 || appleStatus === 4) return 'past_due';
  if (appleStatus === 5) return 'revoked';
  if (appleStatus === 2) return 'canceled';
  throw new Error('Unknown Apple subscription status');
}
