import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { isLogMonth, logMonth, logMonthBounds } from '../utils/vesselLogHistory';

export interface VesselLogPeriodParams {
  historyMonth?: string;
  historyVesselId?: string;
}

export function useCurrentLogMonth(): string {
  const [month, setMonth] = useState(() => logMonth());
  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setTimeout>;
      const refresh = () => {
        clearTimeout(timer);
        const now = new Date();
        const next = logMonth(now);
        setMonth(next);
        // Check the boundary while open, and immediately on resume after a long absence.
        timer = setTimeout(
          refresh,
          Math.min(
            new Date(logMonthBounds(next).end).getTime() - now.getTime() + 50,
            24 * 60 * 60 * 1000
          )
        );
      };
      refresh();
      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh();
      });
      return () => {
        clearTimeout(timer);
        listener.remove();
      };
    }, [])
  );
  return month;
}

export function useVesselLogPeriod(vesselId: string | null, params?: VesselLogPeriodParams) {
  const currentMonth = useCurrentLogMonth();
  const isHistory =
    params?.historyVesselId === vesselId &&
    isLogMonth(params?.historyMonth) &&
    params.historyMonth < currentMonth;
  return { month: isHistory ? params!.historyMonth! : currentMonth, isHistory };
}
