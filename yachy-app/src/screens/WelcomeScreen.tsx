/**
 * Welcome Screen
 * Shows for ~3 seconds on every app open (cold start), then transitions based on auth state.
 * Per ADMIN rule: displays for both new and returning members.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, StatusBar, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONTS, SPACING } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
import { useAuthStore } from '../store';

const MARITIME = {
  bgDark: '#0f172a',
  textOnDark: '#f8fafc',
  textMuted: '#94a3b8',
  gold: '#c9a227',
};

const WELCOME_DURATION_MS = 3000;

export const WelcomeScreen = ({ navigation }: any) => {
  const { isAuthenticated, user } = useAuthStore();
  const isCaptain = user?.position?.toLowerCase().includes('captain') ?? false;
  const hasVessel = !!user?.vesselId;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isAuthenticated) {
        navigation.replace('Login');
      } else if (isCaptain && !hasVessel) {
        navigation.replace('CaptainWelcome');
      } else {
        navigation.replace('MainTabs');
      }
    }, WELCOME_DURATION_MS);
    return () => clearTimeout(timer);
  }, [navigation, isAuthenticated, isCaptain, hasVessel]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={MARITIME.bgDark} />
      <View style={styles.hero}>
        <View style={styles.heroBadge}>
          <Ionicons name="boat-outline" size={20} color={MARITIME.gold} />
          <Text style={styles.heroBadgeText}>Nautical Ops</Text>
        </View>
        <Text style={styles.heroTitle}>Welcome to</Text>
        <Text style={[styles.heroNauticalOps, { fontSize: Math.floor((SCREEN_WIDTH - SPACING.xl * 2) / 6) }]}>
          Nautical Ops
        </Text>
        <Text style={styles.heroSubtitle}>
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
    backgroundColor: MARITIME.bgDark,
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
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 9999,
    marginBottom: SPACING.lg,
  },
  heroBadgeText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    color: MARITIME.textOnDark,
    letterSpacing: 0.5,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: MARITIME.textOnDark,
    marginBottom: SPACING.xs,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  heroNauticalOps: {
    fontWeight: '800',
    color: MARITIME.textOnDark,
    marginBottom: SPACING.sm,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: FONTS.base,
    color: MARITIME.textMuted,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
    marginBottom: SPACING.lg,
  },
  heroAccent: {
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: MARITIME.gold,
    opacity: 0.9,
  },
});
