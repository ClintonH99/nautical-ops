/**
 * The confirm bar shown while a screen is in export-selection mode.
 *
 * Pairs with ExportButton in PageHeader's actions row so every screen that
 * exports behaves and reads the same way: tap Export, tick what you want,
 * confirm. Screens own the selection state; this renders the prompt and the
 * confirm action.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '../hooks/useThemeColors';
import { COLORS, SPACING, BORDER_RADIUS } from '../constants/theme';

interface ExportBarProps {
  /** How many items are currently ticked. */
  count: number;
  onConfirm: () => void;
  /** True while the PDF is being generated. */
  exporting?: boolean;
  /** Override the prompt, e.g. "Tap jobs to select". */
  hint?: string;
}

export const ExportBar: React.FC<ExportBarProps> = ({
  count,
  onConfirm,
  exporting = false,
  hint = 'Tap items to select',
}) => {
  const themeColors = useThemeColors();
  const disabled = exporting || count === 0;

  return (
    <View style={[styles.bar, { backgroundColor: themeColors.surface }]}>
      <Text style={[styles.hint, { color: themeColors.textSecondary }]}>{hint}</Text>
      <TouchableOpacity
        onPress={onConfirm}
        disabled={disabled}
        style={[styles.confirm, { opacity: disabled ? 0.5 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel={`Export ${count} selected to PDF`}
      >
        <Text style={styles.confirmText}>
          {exporting ? 'Exporting…' : `Export to PDF (${count})`}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.xs,
  },
  hint: {
    fontSize: 11,
  },
  confirm: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  confirmText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '500',
  },
});
