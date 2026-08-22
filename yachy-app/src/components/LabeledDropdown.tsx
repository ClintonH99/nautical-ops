/**
 * The standard labelled dropdown: label on the left, the control on the
 * right, both on one line.
 *
 * This is the Watch Duties department layout, adopted as the app-wide
 * standard. Screens keep their own picker (modal, inline list, whatever they
 * already use) - this is only the trigger, so the look stays in one place.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '../hooks/useThemeColors';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';

interface LabeledDropdownProps {
  /** Text on the left, e.g. "Department". */
  label: string;
  /** Current selection, shown inside the control. */
  value: string;
  /** True while the picker is open - flips the chevron. */
  open?: boolean;
  onPress: () => void;
  /** Drop the standard top spacing where the row already sits below a gap. */
  tightTop?: boolean;
}

export const LabeledDropdown: React.FC<LabeledDropdownProps> = ({
  label,
  value,
  open = false,
  onPress,
  tightTop = false,
}) => {
  const themeColors = useThemeColors();

  return (
    <View style={[styles.row, tightTop && styles.rowTight]}>
      <Text style={[styles.label, { color: themeColors.textPrimary }]}>{label}</Text>
      <TouchableOpacity
        style={[styles.dropdown, { backgroundColor: themeColors.surface }]}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
      >
        <Text style={[styles.value, { color: themeColors.textPrimary }]} numberOfLines={1}>
          {value}
        </Text>
        <Text style={[styles.chevron, { color: themeColors.textSecondary }]}>
          {open ? '▲' : '▼'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACING.lg,
    marginBottom: SPACING.md,
    gap: SPACING.md,
  },
  rowTight: {
    marginTop: 0,
  },
  label: {
    fontSize: FONTS.base,
    fontWeight: '600',
    flexShrink: 0,
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
    flexShrink: 1,
    minWidth: 140,
  },
  value: {
    fontSize: FONTS.sm,
    flexShrink: 1,
  },
  chevron: {
    fontSize: 10,
  },
});
