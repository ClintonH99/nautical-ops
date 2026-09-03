import type { User } from '../types';
import { registerCurrentDevice } from './deviceAccess';
import { getVesselSubscriptionAccess } from './subscription';

export const SUBSCRIPTION_PAYMENT_REQUIRED_MESSAGE =
  'You have been temporarily logged out from the vessel until the subscription has been paid, apologies for any inconvenience caused.';

export type AccountAccessDecision =
  | { state: 'allowed' }
  | { state: 'unavailable' }
  | { state: 'captain_payment_required' }
  | { state: 'crew_payment_required' }
  | { state: 'device_limit_reached' };

/**
 * Check device and subscription access for an authenticated profile.
 * Service outages fail open; only a positive server response may restrict
 * access or sign somebody out.
 */
export async function evaluateAccountAccess(user: User): Promise<AccountAccessDecision> {
  const deviceAccess = await registerCurrentDevice();
  if (deviceAccess.state === 'limit_reached') {
    return { state: 'device_limit_reached' };
  }

  if (!user.vesselId) return { state: 'allowed' };

  const subscriptionAccess = await getVesselSubscriptionAccess(user.vesselId);
  if (subscriptionAccess.state === 'unavailable') {
    return { state: 'unavailable' };
  }
  if (subscriptionAccess.state !== 'payment_required') {
    return { state: 'allowed' };
  }

  return user.role === 'CAPTAIN_MOV'
    ? { state: 'captain_payment_required' }
    : { state: 'crew_payment_required' };
}
