/**
 * Privacy Policy Screen
 * Displays the full Privacy Policy in a scrollable view
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES, SHADOWS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { PageHeader } from '../components';
import { PRIVACY_POLICY } from '../constants/legalContent';

export const PrivacyPolicyScreen = () => {
  const themeColors = useThemeColors();

  return (
    <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Privacy Policy" />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
          Last updated: March 2025
        </Text>

        <View style={styles.sectionList}>
          {PRIVACY_POLICY.map((section, index) => (
            <View
              key={index}
              style={[
                styles.section,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: themeColors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.sectionTitle,
                  { color: themeColors.isDark ? COLORS.white : COLORS.primary },
                ]}
              >
                {section.title}
              </Text>
              <Text style={[styles.sectionBody, { color: themeColors.textSecondary }]}>
                {section.content}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  subtitle: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.md,
  },
  sectionList: {
    gap: SPACING.sm,
  },
  section: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    ...SHADOWS.md,
  },
  sectionTitle: {
    fontSize: FONTS.base,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  sectionBody: {
    fontSize: FONTS.sm,
    lineHeight: 22,
  },
});
