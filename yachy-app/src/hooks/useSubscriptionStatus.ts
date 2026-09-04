/**
 * Hook to get vessel subscription status.
 * Used to gate invite code access and show upgrade warnings.
 */

import { useState, useEffect, useCallback } from 'react';
import { getVesselSubscriptionAccess } from '../services/subscription';
import type {
  SubscriptionAccessState,
  VesselSubscription,
  VesselSubscriptionAccess,
} from '../services/subscription';

export interface UseSubscriptionStatusResult {
  hasActiveSubscription: boolean;
  subscription: VesselSubscription | null;
  accessState: SubscriptionAccessState;
  isLoading: boolean;
  refetch: () => Promise<VesselSubscriptionAccess>;
}

export function useSubscriptionStatus(vesselId: string | null): UseSubscriptionStatusResult {
  const [subscription, setSubscription] = useState<VesselSubscription | null>(null);
  const [accessState, setAccessState] = useState<SubscriptionAccessState>('unavailable');
  const [isLoading, setIsLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!vesselId) {
      setSubscription(null);
      setAccessState('never_subscribed');
      setIsLoading(false);
      return { state: 'never_subscribed', subscription: null } as VesselSubscriptionAccess;
    }

    setIsLoading(true);
    const access = await getVesselSubscriptionAccess(vesselId);
    setAccessState(access.state);

    // Keep the last confirmed subscription visible during a temporary service
    // outage. An unavailable check is not evidence that payment has failed.
    if (access.state !== 'unavailable') {
      setSubscription(access.subscription);
    }
    setIsLoading(false);
    return access;
  }, [vesselId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const hasActiveSubscription =
    accessState === 'entitled' ||
    accessState === 'grace_period' ||
    (accessState === 'unavailable' && !!subscription);

  return {
    hasActiveSubscription,
    subscription,
    accessState,
    isLoading,
    refetch: fetch,
  };
}
