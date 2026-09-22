/**
 * Categories Screen
 * Full-screen list of all app categories — everything we're working with
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES, SHADOWS } from '../constants/theme';
import { useThemeStore, BACKGROUND_THEMES } from '../store';
import { CATEGORIES } from '../components/CategorySheet';

export const CategoriesScreen = ({ navigation }: any) => {
  const backgroundTheme = useThemeStore((s) => s.backgroundTheme);
  const themeColors = BACKGROUND_THEMES[backgroundTheme];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.textPrimary }]}>All Categories</Text>
      </View>

      <View style={styles.list}>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.key}
            style={[
              styles.card,
              {
                backgroundColor: themeColors.surface,
                borderColor: themeColors.border,
              },
              !themeColors.isDark && SHADOWS.md,
            ]}
            onPress={() => navigation.navigate(cat.nav)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Open ${cat.label}`}
          >
            <View style={styles.iconTile}>
              <Ionicons name={cat.icon} size={22} color={COLORS.white} />
            </View>
            <Text style={[styles.cardLabel, { color: themeColors.textPrimary }]}>{cat.label}</Text>
            <Ionicons name="chevron-forward" size={20} color={themeColors.textSecondary} />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  header: {
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.lg,
  },
  title: {
    fontSize: FONTS['2xl'],
    fontWeight: '700',
    textAlign: 'center',
  },
  list: {
    gap: SPACING.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 68,
    paddingVertical: SPACING.sm,
    paddingLeft: SPACING.sm,
    paddingRight: SPACING.md,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
  },
  iconTile: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  cardLabel: {
    flex: 1,
    fontSize: FONTS.base,
    fontWeight: '600',
  },
});
