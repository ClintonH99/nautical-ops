/**
 * Theme Settings Screen
 * Lets the user pick a background colour theme for the app
 */

import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeStore, BACKGROUND_THEMES, BackgroundThemeId } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { PageHeader } from '../components';

const THEMES: { id: BackgroundThemeId; label: string; description: string }[] = [
  { id: 'day', label: 'Day', description: 'Clean and bright' },
  { id: 'night', label: 'Night', description: 'Easy on the eyes' },
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
    <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Appearance" />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: themeColors.textSecondary }]}>
          Choose how Nautical Ops looks on this device.
        </Text>

        <View
          style={[
            styles.section,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          {THEMES.map((theme, index) => {
            const isSelected = backgroundTheme === theme.id;
            const colors = BACKGROUND_THEMES[theme.id];
            const isLast = index === THEMES.length - 1;

            return (
              <TouchableOpacity
                key={theme.id}
                style={[
                  styles.row,
                  isLast && styles.rowLast,
                  { borderBottomColor: themeColors.border },
                ]}
                onPress={() => setBackgroundTheme(theme.id)}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.preview,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <Ionicons
                    name={theme.id === 'day' ? 'sunny-outline' : 'moon-outline'}
                    size={20}
                    color={theme.id === 'day' ? COLORS.primary : COLORS.white}
                  />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, { color: themeColors.textPrimary }]}>
                    {theme.label}
                  </Text>
                  <Text style={[styles.rowDesc, { color: themeColors.textSecondary }]}>
                    {theme.description}
                  </Text>
                </View>
                <View
                  style={[
                    styles.radio,
                    {
                      borderColor: isSelected ? themeColors.accent : themeColors.borderStrong,
                    },
                  ]}
                >
                  {isSelected && (
                    <View
                      style={[styles.radioDot, { backgroundColor: themeColors.controlSelected }]}
                    />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  intro: {
    fontSize: FONTS.sm,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  section: {
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
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
