import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import vesselService from '../services/vessel';

/** Retry transient startup failures without clearing a previously loaded name. */
export function useHomeVesselName(vesselId: string | null, onName: (name: string) => void) {
  const [unavailable, setUnavailable] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  useFocusEffect(
    useCallback(() => {
      let disposed = false;
      let pending = false;
      let failures = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      setUnavailable(false);
      const load = async () => {
        if (disposed || pending || !vesselId) return;
        if (Platform.OS === 'web' && typeof document !== 'undefined' && document.hidden) return;
        clearTimeout(timer);
        pending = true;
        try {
          const vessel = await vesselService.getVessel(vesselId);
          if (disposed) return;
          if (!vessel?.name?.trim()) throw new Error('Vessel name unavailable');
          onName(vessel.name);
          failures = 0;
          setUnavailable(false);
        } catch {
          if (disposed) return;
          setUnavailable(true);
          // Bounded backoff: a persistent outage must not poll indefinitely.
          const delay = [1000, 3000, 8000][failures++];
          if (delay !== undefined) timer = setTimeout(() => void load(), delay);
        } finally {
          pending = false;
        }
      };
      const refresh = () => {
        failures = 0;
        void load();
      };
      refreshRef.current = refresh;
      refresh();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.addEventListener('online', refresh);
        window.addEventListener('pageshow', refresh);
        document.addEventListener('visibilitychange', refresh);
      }
      return () => {
        disposed = true;
        clearTimeout(timer);
        refreshRef.current = () => {};
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.removeEventListener('online', refresh);
          window.removeEventListener('pageshow', refresh);
          document.removeEventListener('visibilitychange', refresh);
        }
      };
    }, [vesselId, onName])
  );
  return { unavailable, refresh: useCallback(() => refreshRef.current(), []) };
}
