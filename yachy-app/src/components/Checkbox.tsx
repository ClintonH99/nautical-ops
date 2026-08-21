/**
 * The selection checkbox from ADMIN/App Design/BUTTON_TAG_STANDARD.md.
 *
 * Per that standard it appears only on screens supporting bulk selection -
 * select several, export to PDF, delete selected - and never otherwise.
 *
 * ButtonTagCard has its own copy of this; screens that build their own cards
 * should use this one rather than writing a third.
 */

import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, BORDER_RADIUS } from '../constants/theme';

interface CheckboxProps {
  checked: boolean;
  onPress: () => void;
  /** Unchecked boxes take the card's surface colour so they read in both themes. */
  surface?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({ checked, onPress, surface }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[
      styles.checkbox,
      !checked && surface ? { backgroundColor: surface } : null,
      checked && styles.checked,
    ]}
    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    accessibilityRole="checkbox"
    accessibilityState={{ checked }}
  >
    {checked && <Text style={styles.mark}>✓</Text>}
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 2,
    borderColor: COLORS.gray300,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  mark: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
});
