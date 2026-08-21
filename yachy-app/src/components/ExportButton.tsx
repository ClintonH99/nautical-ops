/**
 * The pill-shaped Export control used in PageHeader's actions row.
 *
 * Screens that export to PDF use a selection flow: tapping Export turns on
 * selection mode (the button becomes Cancel), the user ticks what they want,
 * then confirms. This renders the toggle; the screen owns the state.
 */

import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '../hooks/useThemeColors';
import { COLORS } from '../constants/theme';

interface ExportButtonProps {
  /** True while selection mode is on - the button then reads Cancel. */
  active: boolean;
  onPress: () => void;
  /** Override the resting label, e.g. "Export list". */
  label?: string;
}

export const ExportButton: React.FC<ExportButtonProps> = ({
  active,
  onPress,
  label = 'Export',
}) => {
  const themeColors = useThemeColors();
  const tint = active ? themeColors.textSecondary : COLORS.primary;

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.button, { borderColor: tint }]}
      accessibilityRole="button"
      accessibilityLabel={active ? 'Cancel export' : 'Export to PDF'}
    >
      <Text style={[styles.label, { color: tint }]}>
        {active ? 'Cancel' : `⤓  ${label}`}
      </Text>
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
