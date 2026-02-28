/**
 * Theme Constants
 * Professional nautical-inspired color scheme and styling
 */

export const COLORS = {
  // Primary colors - Professional nautical blues
  primary: '#1E3A8A', // Deep navy blue
  primaryLight: '#3B82F6', // Lighter blue
  primaryDark: '#1E40AF', // Darker navy
  
  // Secondary colors
  secondary: '#0EA5E9', // Ocean blue
  secondaryLight: '#38BDF8',
  
  // Status colors - Task progression
  success: '#10B981', // Green (70-100% time remaining)
  warning: '#F59E0B', // Yellow/Amber (30-70% time remaining)
  danger: '#EF4444', // Red (0-30% time remaining)
  error: '#EF4444', // Error state
  
  // Department colors (Tasks Calendar, Crew Management)
  departmentColors: {
    BRIDGE: '#3B82F6',
    ENGINEERING: '#EF4444',
    EXTERIOR: '#0EA5E9',
    INTERIOR: '#8B5CF6',
    GALLEY: '#10B981',
  } as Record<string, string>,

  // Module colors - Calendar view
  bossTripColor: '#3B82F6', // Blue
  guestTripColor: '#10B981', // Green
  deliveryTripColor: '#F59E0B', // Amber
  yardPeriodColor: '#0D9488', // Teal
  contractorColor: '#F59E0B', // Yellow
  jobColor: '#EF4444', // Red
  dutyColor: '#8B5CF6', // Purple (multiple trip types on same day)
  
  // Swatches for HOD trip color picker (distinct, accessible)
  tripColorSwatches: [
    '#10B981', // Green
    '#3B82F6', // Blue
    '#F59E0B', // Amber
    '#0D9488', // Teal
    '#8B5CF6', // Purple
    '#EC4899', // Pink
    '#EF4444', // Red
    '#6366F1', // Indigo
    '#14B8A6', // Teal light
    '#F97316', // Orange
    '#84CC16', // Lime
    '#06B6D4', // Cyan
  ],
  
  // Neutral colors
  white: '#FFFFFF',
  black: '#000000',
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#111827',
  
  // Background - refined neutrals
  background: '#F8F9FA',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F3F5',
  
  // Text - clear hierarchy
  textPrimary: '#0D0D0D',
  textSecondary: '#64748B',
  textTertiary: '#94A3B8',
  textInverse: '#FFFFFF',
  
  // Border colors
  border: '#E5E7EB',
  borderLight: '#F3F4F6',
  borderDark: '#D1D5DB',
  
  // Overlay
  overlay: 'rgba(0, 0, 0, 0.5)',
  overlayLight: 'rgba(0, 0, 0, 0.3)',
};

export const FONTS = {
  regular: 'System',
  medium: 'System',
  semiBold: 'System',
  bold: 'System',
  // Typography scale — accessible sizes (16px body for readability)
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 28,
  '4xl': 34,
};

// Line heights for readability (1.4–1.5 for body)
export const LINE_HEIGHTS = {
  tight: 1.2,
  normal: 1.4,
  relaxed: 1.5,
  loose: 1.6,
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
};

export const BORDER_RADIUS = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  pill: 9999,
  full: 9999,
};

// Dribbble-style soft, layered shadows
export const SHADOWS = {
  sm: {
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
};

export const SIZES = {
  // Touch targets — min 44pt (Apple HIG, Material Design)
  minTouchTarget: 44,
  buttonHeight: 48,
  inputHeight: 48,
  iconSize: 24,
  avatarSize: 48,

  // Header
  headerHeight: 56,

  // Tab bar
  tabBarHeight: 64,

  /** Extra padding at bottom of scroll content (tab bar + safe area). */
  bottomScrollPadding: 100,
};

export default {
  COLORS,
  FONTS,
  SPACING,
  BORDER_RADIUS,
  SHADOWS,
  SIZES,
  LINE_HEIGHTS,
};
