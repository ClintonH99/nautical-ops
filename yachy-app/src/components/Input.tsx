/**
 * Reusable Text Input Component
 */

import React, { useState } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TextInputProps,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerStyle?: any;
  variant?: 'default' | 'search';
  showPasswordToggle?: boolean;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  leftIcon,
  rightIcon,
  containerStyle,
  style: inputStyle,
  multiline,
  variant = 'default',
  showPasswordToggle = false,
  secureTextEntry,
  ...textInputProps
}) => {
  const themeColors = useThemeColors();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isSearch = variant === 'search';
  const bgColor = isSearch ? COLORS.white : (themeColors.isDark ? themeColors.surface : COLORS.surface);
  const textColor = isSearch ? COLORS.black : themeColors.textPrimary;

  const effectiveSecureTextEntry = showPasswordToggle ? !passwordVisible : secureTextEntry;
  const passwordToggleIcon = showPasswordToggle ? (
    <TouchableOpacity
      onPress={() => setPasswordVisible((v) => !v)}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={styles.toggleTouch}
    >
      <Ionicons
        name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
        size={22}
        color={themeColors.textSecondary}
      />
    </TouchableOpacity>
  ) : null;

  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={[styles.label, { color: themeColors.textPrimary }]}>{label}</Text>}
      <View
        style={[
          styles.inputContainer,
          { backgroundColor: bgColor },
          multiline && styles.inputContainerMultiline,
          error && styles.inputContainerError,
          isSearch && styles.inputContainerSearch,
        ]}
      >
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
        <TextInput
          style={[styles.input, { color: textColor }, multiline && styles.inputMultiline, isSearch && styles.inputSearch, inputStyle]}
          placeholderTextColor={isSearch ? COLORS.gray500 : COLORS.gray400}
          multiline={multiline}
          secureTextEntry={effectiveSecureTextEntry}
          {...textInputProps}
        />
        {(passwordToggleIcon && <View style={styles.rightIcon}>{passwordToggleIcon}</View>) || (rightIcon && <View style={styles.rightIcon}>{rightIcon}</View>)}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: SIZES.inputHeight,
    height: SIZES.inputHeight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
  },
  inputContainerMultiline: {
    height: undefined,
    minHeight: 88,
    alignItems: 'flex-start',
    paddingVertical: SPACING.sm,
  },
  inputContainerError: {
    borderColor: COLORS.danger,
  },
  inputContainerSearch: {
    backgroundColor: COLORS.white,
  },
  input: {
    flex: 1,
    fontSize: FONTS.base,
    paddingVertical: 0,
    textDecorationLine: 'none',
    lineHeight: FONTS.base * 1.4,
  },
  inputMultiline: {
    minHeight: 60,
    paddingVertical: 0,
    textAlignVertical: 'top',
  },
  inputSearch: {
    color: COLORS.black,
  },
  leftIcon: {
    marginRight: SPACING.sm,
  },
  rightIcon: {
    marginLeft: SPACING.sm,
  },
  toggleTouch: {
    padding: SPACING.xs,
  },
  error: {
    fontSize: FONTS.xs,
    color: COLORS.danger,
    marginTop: SPACING.xs,
  },
});
