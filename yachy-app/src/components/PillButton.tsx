/**
 * Small outlined pill for header actions, sized to match ExportButton so
 * anything sitting in PageHeader's actions row looks like a set.
 */

import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

interface PillButtonProps {
  label: string;
  onPress: () => void;
  /** Override the outline and text colour. Defaults to the app navy. */
  tint?: string;
}

export const PillButton: React.FC<PillButtonProps> = ({ label, onPress, tint }) => {
  const themeColors = useThemeColors();
  const resolvedTint = tint ?? (themeColors.isDark ? COLORS.white : COLORS.primary);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.button, { borderColor: resolvedTint }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[styles.label, { color: resolvedTint }]}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 18,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
  },
});
