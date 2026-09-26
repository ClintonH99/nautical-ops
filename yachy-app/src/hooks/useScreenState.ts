import { Dispatch, SetStateAction, useCallback, useRef, useState } from 'react';
import { useRoute } from '@react-navigation/native';
import { useAuthStore } from '../store';
import {
  getScreenCacheGeneration,
  readScreenCache,
  writeScreenCache,
  withoutPendingRemovals,
} from '../utils/screenCache';

/** Retain server-backed screen data, never unsaved form fields or pending actions. */
export function useScreenState<T>(
  name: string,
  initial: T | (() => T)
): [T, Dispatch<SetStateAction<T>>] {
  const route = useRoute();
  const user = useAuthStore((s) => s.user);
  const generation = getScreenCacheGeneration();
  const params = route.name === 'WatchSchedule' ? {} : (route.params ?? {});
  const key = JSON.stringify([
    user?.id,
    user?.vesselId,
    user?.role,
    user?.department,
    user?.department2,
    route.name,
    params,
    name,
  ]);
  const initialRef = useRef(initial);
  const makeInitial = () =>
    typeof initialRef.current === 'function'
      ? (initialRef.current as () => T)()
      : initialRef.current;
  const [state, setState] = useState(() => ({
    key,
    generation,
    value: readScreenCache<T>(key) ?? makeInitial(),
  }));
  const current = useRef(state);
  if (current.current.key !== key || current.current.generation !== generation) {
    current.current = { key, generation, value: readScreenCache<T>(key) ?? makeInitial() };
  }
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      if (generation !== getScreenCacheGeneration() || current.current.key !== key) return;
      const previous = current.current.value;
      const value = withoutPendingRemovals(
        typeof next === 'function' ? (next as (previous: T) => T)(previous) : next
      );
      current.current = { key, generation, value };
      writeScreenCache(key, value, generation);
      setState(current.current);
    },
    [key, generation]
  );
  return [current.current.value, setValue];
}

/** Focus refreshes keep already loaded content on screen. */
export function useScreenLoading(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [loaded, setLoaded] = useScreenState('loaded', false);
  const setLoading = useCallback<Dispatch<SetStateAction<boolean>>>(
    (next) => {
      setLoaded((previous) => {
        const loading = typeof next === 'function' ? next(!previous) : next;
        return previous || !loading;
      });
    },
    [setLoaded]
  );
  return [!loaded, setLoading];
}
