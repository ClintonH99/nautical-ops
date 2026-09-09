import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';
import { COLORS, FONTS, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

interface EnterToAddHintProps {
  style?: StyleProp<TextStyle>;
}

export const EnterToAddHint: React.FC<EnterToAddHintProps> = ({ style }) => {
  const themeColors = useThemeColors();

  return (
    <Text
      style={[
        styles.hint,
        { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
        style,
      ]}
    >
      Press Enter to add new line.
    </Text>
  );
};

const styles = StyleSheet.create({
  hint: {
    fontSize: FONTS.xs,
    fontFamily: FONTS.regular,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
  },
});
