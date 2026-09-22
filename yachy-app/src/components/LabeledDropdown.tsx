/**
 * The standard labelled dropdown. It uses the app-wide horizontal layout by
 * default and can stack the label above the control inside compact forms.
 *
 * This is the Watch Duties department layout, adopted as the app-wide
 * standard. Screens keep their own picker (modal, inline list, whatever they
 * already use) - this is only the trigger, so the look stays in one place.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../hooks/useThemeColors';
import { FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';

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
  /** Optional control text colour for domain-specific dropdown standards. */
  valueColor?: string;
  /** Optional chevron colour; defaults to valueColor when supplied. */
  iconColor?: string;
  /** Use a full-width control below the label inside stacked forms. */
  layout?: 'row' | 'stacked';
}

export const LabeledDropdown: React.FC<LabeledDropdownProps> = ({
  label,
  value,
  open = false,
  onPress,
  tightTop = false,
  valueColor,
  iconColor,
  layout = 'row',
}) => {
  const themeColors = useThemeColors();
  const resolvedValueColor = valueColor ?? themeColors.accent;
  const resolvedIconColor = iconColor ?? resolvedValueColor;

  return (
    <View
      style={[styles.row, layout === 'stacked' && styles.rowStacked, tightTop && styles.rowTight]}
    >
      <Text
        style={[
          styles.label,
          layout === 'stacked' && styles.labelStacked,
          { color: themeColors.textPrimary },
        ]}
      >
        {label}
      </Text>
      <TouchableOpacity
        style={[
          styles.dropdown,
          layout === 'stacked' && styles.dropdownStacked,
          {
            backgroundColor: themeColors.control,
            borderColor: open ? themeColors.borderStrong : themeColors.border,
          },
        ]}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.value, { color: resolvedValueColor }]} numberOfLines={1}>
          {value}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={resolvedIconColor} />
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
  rowStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 0,
  },
  label: {
    fontSize: FONTS.base,
    fontWeight: '600',
    flexShrink: 0,
  },
  labelStacked: {
    marginBottom: SPACING.xs,
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexGrow: 1,
    flexBasis: 180,
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    gap: SPACING.sm,
    flexShrink: 1,
    minWidth: 0,
  },
  dropdownStacked: {
    width: '100%',
    flexGrow: 0,
    flexBasis: 'auto',
  },
  value: {
    fontSize: FONTS.base,
    fontWeight: '600',
    flexShrink: 1,
  },
});
