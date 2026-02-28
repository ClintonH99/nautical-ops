/**
 * Global State Management using Zustand
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../constants/theme';
import { User } from '../types';

const DEPARTMENT_COLOR_STORAGE_KEY = 'nautical_ops_department_color_overrides';
const BACKGROUND_THEME_STORAGE_KEY = 'nautical_ops_background_theme';

// ===== AUTH STORE =====

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setLoading: (loading) => set({ isLoading: loading }),
  logout: () => set({ user: null, isAuthenticated: false }),
}));

// ===== APP STORE (General app state) =====

interface AppState {
  vesselId: string | null;
  vesselName: string | null;
  offlineMode: boolean;
  syncPending: boolean;
  setVessel: (id: string, name: string) => void;
  setOfflineMode: (offline: boolean) => void;
  setSyncPending: (pending: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  vesselId: null,
  vesselName: null,
  offlineMode: false,
  syncPending: false,
  setVessel: (id, name) => set({ vesselId: id, vesselName: name }),
  setOfflineMode: (offline) => set({ offlineMode: offline }),
  setSyncPending: (pending) => set({ syncPending: pending }),
}));

// ===== DEPARTMENT COLOR OVERRIDES (crew choose color or no color per department) =====

export type DepartmentColorOverrides = Record<string, string | null>;

interface DepartmentColorState {
  overrides: DepartmentColorOverrides;
  loaded: boolean;
  loadOverrides: () => Promise<void>;
  setOverride: (department: string, color: string | null) => Promise<void>;
}

export const useDepartmentColorStore = create<DepartmentColorState>((set, get) => ({
  overrides: {},
  loaded: false,
  loadOverrides: async () => {
    try {
      const raw = await AsyncStorage.getItem(DEPARTMENT_COLOR_STORAGE_KEY);
      const overrides = raw ? JSON.parse(raw) : {};
      set({ overrides, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  setOverride: async (department, color) => {
    const next = { ...get().overrides, [department]: color };
    set({ overrides: next });
    try {
      await AsyncStorage.setItem(DEPARTMENT_COLOR_STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.error('Save department color override:', e);
    }
  },
}));

/** Returns effective department color (override, theme default, or gray for no color). */
export function getDepartmentColor(
  department: string,
  overrides: DepartmentColorOverrides
): string {
  const v = overrides[department];
  if (v === null) return COLORS.gray300;
  return v ?? COLORS.departmentColors?.[department] ?? COLORS.gray300;
}

// ===== BACKGROUND THEME (home/explore/profile background and surfaces) =====

export type BackgroundThemeId = 'day' | 'night';

interface BackgroundThemeColors {
  background: string;
  surface: string;
  surfaceAlt: string;
  textPrimary: string;
  textSecondary: string;
  isDark: boolean;
}

export const BACKGROUND_THEMES: Record<BackgroundThemeId, BackgroundThemeColors> = {
  day: {
    background: '#F8F9FA',
    surface: '#FFFFFF',
    surfaceAlt: '#F1F3F5',
    textPrimary: '#0D0D0D',
    textSecondary: '#64748B',
    isDark: false,
  },
  night: {
    background: '#0F172A',
    surface: '#1E293B',
    surfaceAlt: '#334155',
    textPrimary: '#F8FAFC',
    textSecondary: '#94A3B8',
    isDark: true,
  },
};

interface ThemeState {
  backgroundTheme: BackgroundThemeId;
  loaded: boolean;
  loadTheme: () => Promise<void>;
  setBackgroundTheme: (id: BackgroundThemeId) => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  backgroundTheme: 'day',
  loaded: false,
  loadTheme: async () => {
    try {
      const raw = await AsyncStorage.getItem(BACKGROUND_THEME_STORAGE_KEY);
      const id = (raw as BackgroundThemeId) || 'day';
      const valid = ['day', 'night'].includes(id);
      set({ backgroundTheme: valid ? id : 'day', loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  setBackgroundTheme: async (id) => {
    set({ backgroundTheme: id });
    try {
      await AsyncStorage.setItem(BACKGROUND_THEME_STORAGE_KEY, id);
    } catch (e) {
      console.error('Save background theme:', e);
    }
  },
}));
