/**
 * Categories Screen
 * Full-screen list of all app categories — everything we're working with
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
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
        <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
          Everything available in the app
        </Text>
      </View>

      <View style={styles.list}>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.key}
            style={[styles.card, { backgroundColor: themeColors.surface }]}
            onPress={() => navigation.navigate(cat.nav)}
            activeOpacity={0.8}
          >
            <Text style={styles.cardIcon}>{cat.icon}</Text>
            <Text style={[styles.cardLabel, { color: themeColors.textPrimary }]}>{cat.label}</Text>
            <Text style={[styles.chevron, { color: themeColors.textSecondary }]}>›</Text>
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
    paddingBottom: SPACING.xl,
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONTS['2xl'],
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONTS.base,
  },
  list: {},
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.md,
    ...SHADOWS.lg,
  },
  cardIcon: {
    fontSize: 28,
    marginRight: SPACING.lg,
  },
  cardLabel: {
    flex: 1,
    fontSize: FONTS.lg,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 24,
  },
});
