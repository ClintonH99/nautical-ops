/**
 * Reusable Button Component
 */

import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'outlineLight' | 'danger' | 'text';
  size?: 'small' | 'medium' | 'large';
  shape?: 'default' | 'pill';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  shape = 'default',
  disabled = false,
  loading = false,
  fullWidth = false,
  style,
  textStyle,
}) => {
  const variantKey = variant === 'outlineLight' ? 'outlineLight' : variant;
  const variantStyle: ViewStyle =
    variant === 'text' ? styles.textVariant : (styles[variantKey as keyof typeof styles] as ViewStyle);
  const textKey = `${variantKey}Text`;
  const buttonStyles: ViewStyle[] = [styles.button, variantStyle];
  const textStyles: TextStyle[] = [styles.baseText, styles[textKey as keyof typeof styles] as TextStyle];

  // Size variations
  if (size === 'small') {
    buttonStyles.push(styles.small);
    textStyles.push(styles.smallText);
  } else if (size === 'large') {
    buttonStyles.push(styles.large);
    textStyles.push(styles.largeText);
  }

  if (shape === 'pill') {
    buttonStyles.push(styles.pill);
  }

  if (fullWidth) {
    buttonStyles.push(styles.fullWidth);
  }

  if (disabled || loading) {
    buttonStyles.push(styles.disabled);
  }

  if (style) {
    buttonStyles.push(style);
  }

  if (textStyle) {
    textStyles.push(textStyle);
  }

  return (
    <TouchableOpacity
      style={buttonStyles}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator
          color={
            variant === 'outlineLight'
              ? COLORS.white
              : variant === 'outline' || variant === 'text'
                ? COLORS.primary
                : COLORS.white
          }
        />
      ) : (
        <Text style={textStyles}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    height: SIZES.buttonHeight,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  pill: {
    borderRadius: BORDER_RADIUS.pill,
  },
  fullWidth: {
    width: '100%',
  },
  baseText: {
    fontSize: FONTS.base,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  // Variants
  primary: {
    backgroundColor: COLORS.primary,
  },
  primaryText: {
    color: COLORS.white,
  },
  secondary: {
    backgroundColor: COLORS.secondary,
  },
  secondaryText: {
    color: COLORS.white,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  outlineText: {
    color: COLORS.primary,
  },
  outlineLight: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  outlineLightText: {
    color: COLORS.white,
  },
  danger: {
    backgroundColor: COLORS.danger,
  },
  dangerText: {
    color: COLORS.white,
  },
  textVariant: {
    backgroundColor: 'transparent',
  },
  textText: {
    color: COLORS.primary,
    fontWeight: '500',
  },
  // Sizes
  small: {
    height: 36,
    paddingHorizontal: SPACING.md,
  },
  smallText: {
    fontSize: FONTS.sm,
  },
  large: {
    height: 56,
    paddingHorizontal: SPACING.xl,
  },
  largeText: {
    fontSize: FONTS.lg,
  },
  // States
  disabled: {
    opacity: 0.5,
  },
});
