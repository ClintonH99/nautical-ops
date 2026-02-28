/**
 * Hook to get current theme colors (Day/Night mode)
 */

import { useThemeStore, BACKGROUND_THEMES } from '../store';

export function useThemeColors() {
  const backgroundTheme = useThemeStore((s) => s.backgroundTheme);
  return BACKGROUND_THEMES[backgroundTheme];
}
