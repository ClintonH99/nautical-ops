import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BORDER_RADIUS, COLORS, FONTS, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

interface TripLoadErrorBannerProps {
  onRetry: () => void;
}

export const TripLoadErrorBanner = ({ onRetry }: TripLoadErrorBannerProps) => {
  const themeColors = useThemeColors();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: themeColors.surface, borderColor: COLORS.border },
      ]}
    >
      <Text style={[styles.message, { color: themeColors.textPrimary }]}>
        Trips could not be refreshed. Check your connection and try again.
      </Text>
      <TouchableOpacity style={styles.retryButton} onPress={onRetry} activeOpacity={0.8}>
        <Text style={styles.retryText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    padding: SPACING.md,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    gap: SPACING.sm,
  },
  message: {
    fontSize: FONTS.sm,
    lineHeight: 20,
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
  },
  retryText: {
    color: COLORS.white,
    fontSize: FONTS.sm,
    fontWeight: '600',
  },
});
