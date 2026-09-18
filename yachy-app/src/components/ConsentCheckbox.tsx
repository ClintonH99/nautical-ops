/**
 * Consent Checkbox
 * "I agree to the Terms & Conditions and Privacy Policy" with links
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

interface ConsentCheckboxProps {
  checked: boolean;
  onToggle: () => void;
  onPressTerms?: () => void;
  onPressPrivacy?: () => void;
  textColor?: string;
  error?: string;
}

export const ConsentCheckbox = ({
  checked,
  onToggle,
  onPressTerms,
  onPressPrivacy,
  textColor,
  error,
}: ConsentCheckboxProps) => {
  const themeColors = useThemeColors();
  const linkColor = themeColors.isDark ? themeColors.accent : COLORS.primary;
  const resolvedTextColor = textColor ?? themeColors.textPrimary;

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.row} onPress={onToggle} activeOpacity={0.7}>
        <View
          style={[
            styles.checkbox,
            {
              backgroundColor: checked ? themeColors.controlSelected : themeColors.control,
              borderColor: checked ? themeColors.accent : themeColors.borderStrong,
            },
          ]}
        >
          {checked && <Text style={[styles.check, { color: themeColors.textOnAccent }]}>✓</Text>}
        </View>
        <Text style={[styles.text, { color: resolvedTextColor }]}>
          {'I agree to the '}
          <Text
            style={[styles.link, { color: linkColor }]}
            onPress={(e) => {
              e.stopPropagation();
              onPressTerms?.();
            }}
          >
            Terms & Conditions
          </Text>{' '}
          and{' '}
          <Text
            style={[styles.link, { color: linkColor }]}
            onPress={(e) => {
              e.stopPropagation();
              onPressPrivacy?.();
            }}
          >
            Privacy Policy
          </Text>
        </Text>
      </TouchableOpacity>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 2,
    borderColor: COLORS.gray400,
    marginRight: SPACING.sm,
    marginTop: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  check: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: 'bold',
  },
  text: {
    flex: 1,
    fontSize: FONTS.sm,
    lineHeight: 22,
  },
  link: {
    color: COLORS.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  error: {
    fontSize: FONTS.xs,
    color: COLORS.danger,
    marginTop: SPACING.xs,
  },
});
