/**
 * Welcome Screen
 * Branded splash for logged-out cold start (~3s), then Login.
 * Logged-in users skip this screen (RootNavigator goes straight to MainTabs / CaptainWelcome).
 * If auth completes while this screen is visible, navigate home immediately.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, StatusBar, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONTS, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
import { useAuthStore } from '../store';

const ACCENT_GOLD = '#c9a227';

export const WelcomeScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { isAuthenticated, user } = useAuthStore();
  const isCaptain = user?.role === 'CAPTAIN_MOV';
  const hasVessel = !!user?.vesselId;

  useEffect(() => {
    if (isAuthenticated && user) {
      if (isCaptain && !hasVessel) {
        navigation.replace('CaptainWelcome');
      } else {
        navigation.replace('MainTabs');
      }
      return;
    }

    navigation.replace('Login');
  }, [navigation, isAuthenticated, user, isCaptain, hasVessel]);

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <StatusBar
        barStyle={themeColors.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={themeColors.background}
      />
      <View style={styles.hero}>
        <View style={[styles.heroBadge, { backgroundColor: themeColors.surface }]}>
          <Ionicons name="boat-outline" size={20} color={ACCENT_GOLD} />
          <Text style={[styles.heroBadgeText, { color: themeColors.textPrimary }]}>Nautical Ops</Text>
        </View>
        <Text style={[styles.heroTitle, { color: themeColors.textPrimary }]}>Welcome to</Text>
        <Text
          style={[
            styles.heroNauticalOps,
            { color: themeColors.textPrimary },
            { fontSize: Math.floor((SCREEN_WIDTH - SPACING.xl * 2) / 6) },
          ]}
        >
          Nautical Ops
        </Text>
        <Text style={[styles.heroSubtitle, { color: themeColors.textSecondary }]}>
          An App for Crew from Crew.
        </Text>
        <View style={styles.heroAccent} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hero: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 9999,
    marginBottom: SPACING.lg,
  },
  heroBadgeText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: SPACING.xs,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  heroNauticalOps: {
    fontWeight: '800',
    marginBottom: SPACING.sm,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: FONTS.base,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
    marginBottom: SPACING.lg,
  },
  heroAccent: {
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: ACCENT_GOLD,
    opacity: 0.9,
  },
});
