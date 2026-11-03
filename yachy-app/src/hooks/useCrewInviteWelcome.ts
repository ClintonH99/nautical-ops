import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getVesselSubscriptionAccess } from '../services/subscription';
import { useAuthStore } from '../store';

/** Checkout flags request presentation only. Only a fresh server read confirms access. */
export function useCrewInviteWelcome(requested: boolean) {
  const { user, captainPaymentRequired, crewPaymentRequired } = useAuthStore();
  const owner = `${user?.id}:${user?.vesselId}`;
  const eligible =
    requested &&
    user?.role === 'CAPTAIN_MOV' &&
    !!user.vesselId &&
    !captainPaymentRequired &&
    !crewPaymentRequired;
  const [result, setResult] = useState<{
    key: string;
    status: 'ready' | 'unavailable' | 'ineligible';
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${owner}:${attempt}`;
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setResult(null);
      if (!eligible || !user?.vesselId) return;
      const id = user.id;
      const vesselId = user.vesselId;
      void getVesselSubscriptionAccess(vesselId)
        .then((access) => {
          const current = useAuthStore.getState();
          if (
            !active ||
            current.user?.id !== id ||
            current.user.vesselId !== vesselId ||
            current.user.role !== 'CAPTAIN_MOV' ||
            current.captainPaymentRequired ||
            current.crewPaymentRequired
          )
            return;
          const confirmed =
            access.state === 'entitled' &&
            access.subscription?.vesselId === vesselId &&
            Date.parse(access.subscription.currentPeriodEnd) > Date.now();
          setResult({
            key: requestKey,
            status: confirmed
              ? 'ready'
              : access.state === 'unavailable'
                ? 'unavailable'
                : 'ineligible',
          });
        })
        .catch(() => {
          if (active) setResult({ key: requestKey, status: 'unavailable' });
        });
      return () => {
        active = false;
      };
    }, [eligible, user?.id, user?.vesselId, requestKey])
  );
  const status = eligible
    ? result?.key === requestKey
      ? result.status
      : 'checking'
    : 'ineligible';
  return { status, retry: () => setAttempt((value) => value + 1) };
}
