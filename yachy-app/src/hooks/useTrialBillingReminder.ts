import { useCallback, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { getVesselSubscriptionAccess } from '../services/subscription';
import { getTrialBillingReminder, type TrialBillingReminder } from '../utils/trialBillingReminder';

export function useTrialBillingReminder({
  enabled,
  userId,
  vesselId,
  role,
}: {
  enabled: boolean;
  userId: string | null;
  vesselId: string | null;
  role: string | null;
}) {
  const focused = useIsFocused();
  const scope = JSON.stringify([userId, vesselId, role]);
  const [pending, setPending] = useState<{ scope: string; reminder: TrialBillingReminder } | null>(
    null
  );
  const dismissed = useRef(new Set<string>());
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setPending(null);
      if (!enabled || !userId || !vesselId || role !== 'CAPTAIN_MOV') return;
      void (async () => {
        try {
          const access = await getVesselSubscriptionAccess(vesselId);
          if (cancelled) return;
          const reminder = getTrialBillingReminder(access, userId, vesselId, role);
          if (!reminder || dismissed.current.has(reminder.key)) return;
          const seen = await AsyncStorage.getItem(reminder.key);
          if (!cancelled && seen !== 'dismissed' && Date.parse(reminder.endsAt) > Date.now()) {
            setPending({ scope, reminder });
          }
        } catch {
          // Reminder/storage outages must never block Home or imply non-payment.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [enabled, userId, vesselId, role, scope])
  );

  const reminder = enabled && focused && pending?.scope === scope ? pending.reminder : null;
  const dismiss = useCallback(() => {
    if (!reminder) return;
    dismissed.current.add(reminder.key);
    setPending(null);
    void AsyncStorage.setItem(reminder.key, 'dismissed').catch(() => {
      // It stays dismissed in this session even if local persistence fails.
    });
  }, [reminder]);
  return { reminder, dismiss };
}
