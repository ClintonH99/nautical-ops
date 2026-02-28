/**
 * Theme Settings Screen
 * Lets the user pick a background colour theme for the app
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeStore, BACKGROUND_THEMES, BackgroundThemeId } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';

const THEMES: { id: BackgroundThemeId; label: string; description: string }[] = [
  { id: 'day', label: 'Day', description: 'Light mode — clean and bright' },
  { id: 'night', label: 'Night', description: 'Dark mode — easy on the eyes' },
];

export const ThemeSettingsScreen = () => {
  const themeColors = useThemeColors();
  const { backgroundTheme, loaded, loadTheme, setBackgroundTheme } = useThemeStore();

  useFocusEffect(
    useCallback(() => {
      loadTheme();
    }, [loadTheme])
  );

  if (!loaded) return null;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: themeColors.textPrimary }]}>Appearance</Text>
      <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
        Background theme: Day or Night Mode
      </Text>

      <View style={[styles.section, { backgroundColor: themeColors.surface }]}>
        {THEMES.map((theme, index) => {
          const isSelected = backgroundTheme === theme.id;
          const colors = BACKGROUND_THEMES[theme.id];
          const isLast = index === THEMES.length - 1;

          return (
            <TouchableOpacity
              key={theme.id}
              style={[styles.row, isLast && styles.rowLast, { borderBottomColor: themeColors.surfaceAlt }]}
              onPress={() => setBackgroundTheme(theme.id)}
              activeOpacity={0.7}
            >
              <View style={[styles.preview, { backgroundColor: colors.background }]}>
                <View style={[styles.previewDot, { backgroundColor: colors.surface }]} />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, { color: themeColors.textPrimary }]}>{theme.label}</Text>
                <Text style={[styles.rowDesc, { color: themeColors.textSecondary }]}>{theme.description}</Text>
              </View>
              <View style={[styles.radio, isSelected && styles.radioSelected]}>
                {isSelected && <View style={styles.radioDot} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  title: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.xl,
  },
  section: {
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    gap: SPACING.md,
  },
  rowLast: { borderBottomWidth: 0 },
  preview: {
    width: 40,
    height: 40,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rowText: { flex: 1 },
  rowLabel: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  rowDesc: {
    fontSize: FONTS.sm,
    marginTop: 2,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioSelected: {
    borderColor: COLORS.primary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
});
