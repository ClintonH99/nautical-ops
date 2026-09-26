import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useScreenState } from './useScreenState';
import { createdInLogMonth } from '../utils/vesselLogHistory';

/** Period-scoped caches keep previous months out of new-month views, including while offline. */
export function useMonthlyVesselLogs<T extends { vesselId: string; createdAt: string }>(
  vesselId: string | null,
  month: string,
  fetchLogs: (vesselId: string, month: string) => Promise<T[]>
) {
  const [storedLogs, setLogs] = useScreenState<T[]>(`logs:${month}`, []);
  const [loaded, setLoaded] = useScreenState(`loaded:${month}`, false);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const generation = useRef(0);
  const scope = `${vesselId}:${month}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const loadLogs = useCallback(async () => {
    const request = ++generation.current;
    const current = () => request === generation.current && currentScope.current === scope;
    if (!vesselId) return;
    try {
      const data = await fetchLogs(vesselId, month);
      if (!current()) return;
      setLogs(data);
      setLoaded(true);
      setFailure(null);
    } catch {
      if (current()) setFailure(scope);
    } finally {
      if (current()) setRefreshing(false);
    }
  }, [vesselId, month, scope, fetchLogs, setLogs, setLoaded]);
  useFocusEffect(
    useCallback(() => {
      loadLogs();
      return () => {
        generation.current += 1;
      };
    }, [loadLogs])
  );
  const error = failure === scope;
  return {
    logs: storedLogs.filter(
      (log) => log.vesselId === vesselId && createdInLogMonth(log.createdAt, month)
    ),
    setLogs,
    loading: !loaded && !error,
    error,
    refreshing,
    onRefresh: () => {
      setRefreshing(true);
      loadLogs();
    },
    loadLogs,
  };
}
