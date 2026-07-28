/**
 * Captain Welcome Screen
 * Shown after captain registration - prompts to create a vessel
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../components';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

const ICON_ACCENT = '#0ea5e9';

export const CaptainWelcomeScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.icon}>🎉</Text>
          <Text style={[styles.title, { color: themeColors.textPrimary }]}>Account Created!</Text>
          <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
          You're all set as Captain (MOV). Create your vessel to get started and invite your crew.
          </Text>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: themeColors.surface,
              borderColor: themeColors.isDark ? 'rgba(255,255,255,0.1)' : COLORS.border,
            },
          ]}
        >
          <View style={styles.optionRow}>
            <View style={styles.optionIconWrap}>
              <Ionicons name="boat-outline" size={28} color={ICON_ACCENT} />
            </View>
            <View style={styles.optionText}>
              <Text style={[styles.optionTitle, { color: themeColors.textPrimary }]}>Create a Vessel</Text>
              <Text style={[styles.optionDesc, { color: themeColors.textSecondary }]}>
                Set up your yacht, get an invite code, and start managing operations
              </Text>
            </View>
          </View>

          <Button
            title="Create a Vessel"
            onPress={() => navigation.navigate('CreateVessel')}
            fullWidth
            style={styles.primaryButton}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: 80,
    paddingBottom: SPACING['2xl'],
  },
  header: {
    alignItems: 'center',
    marginBottom: SPACING['2xl'],
  },
  icon: {
    fontSize: 56,
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONTS['2xl'],
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONTS.base,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: SPACING.md,
  },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    borderWidth: 1,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.xl,
  },
  optionIconWrap: {
    width: 48,
    height: 48,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: 'rgba(14, 165, 233, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  optionDesc: {
    fontSize: FONTS.sm,
    lineHeight: 20,
  },
  primaryButton: {
    marginBottom: 0,
  },
});
