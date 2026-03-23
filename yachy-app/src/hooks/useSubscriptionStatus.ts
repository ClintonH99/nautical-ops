/**
 * Hook to get vessel subscription status.
 * Used to gate invite code access and show upgrade warnings.
 */

import { useState, useEffect, useCallback } from 'react';
import { getVesselSubscription } from '../services/subscription';
import type { VesselSubscription } from '../services/subscription';

export interface UseSubscriptionStatusResult {
  hasActiveSubscription: boolean;
  subscription: VesselSubscription | null;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

export function useSubscriptionStatus(vesselId: string | null): UseSubscriptionStatusResult {
  const [subscription, setSubscription] = useState<VesselSubscription | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!vesselId) {
      setSubscription(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const sub = await getVesselSubscription(vesselId);
      setSubscription(sub);
    } catch {
      setSubscription(null);
    } finally {
      setIsLoading(false);
    }
  }, [vesselId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const hasActiveSubscription = !!subscription;

  return {
    hasActiveSubscription,
    subscription,
    isLoading,
    refetch: fetch,
  };
}
