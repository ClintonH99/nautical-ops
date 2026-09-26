import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useThemeColors } from '../hooks/useThemeColors';

/** Quiet, non-spinning feedback; the legacy name keeps existing callers compatible. */
export const LoadingSpinner = ({
  size = 'large',
  color,
  style,
}: {
  size?: 'small' | 'large';
  color?: string;
  style?: StyleProp<ViewStyle>;
}) => {
  const theme = useThemeColors();
  if (size === 'small') {
    return (
      <View style={style}>
        <Text
          accessibilityRole="progressbar"
          accessibilityLabel="Loading"
          style={{ color: color ?? theme.textSecondary }}
        >
          …
        </Text>
      </View>
    );
  }
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading content"
      accessibilityState={{ busy: true }}
      style={[styles.content, style]}
    >
      {[72, 100, 88].map((width) => (
        <View
          key={width}
          style={[styles.line, { width: `${width}%`, backgroundColor: theme.border }]}
        />
      ))}
    </View>
  );
};
const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 480, padding: 24, gap: 18, alignSelf: 'center' },
  line: { height: 16, borderRadius: 8, opacity: 0.65 },
});
