/**
 * Privacy Policy Screen
 * Displays the full Privacy Policy in a scrollable view
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { PRIVACY_POLICY } from '../constants/legalContent';

export const PrivacyPolicyScreen = () => {
  const themeColors = useThemeColors();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: themeColors.textPrimary }]}>
        Privacy Policy
      </Text>
      <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
        Last updated: March 2025
      </Text>

      <View style={[styles.section, { backgroundColor: themeColors.surface }]}>
        {PRIVACY_POLICY.map((section, index) => (
          <View
            key={index}
            style={[
              styles.sectionBlock,
              index < PRIVACY_POLICY.length - 1 && {
                borderBottomWidth: 1,
                borderBottomColor: themeColors.surfaceAlt,
              },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: themeColors.textPrimary }]}>
              {section.title}
            </Text>
            <Text style={[styles.sectionBody, { color: themeColors.textSecondary }]}>
              {section.content}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
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
    padding: SPACING.lg,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  sectionBlock: {
    paddingVertical: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.base,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  sectionBody: {
    fontSize: FONTS.sm,
    lineHeight: 22,
  },
});
