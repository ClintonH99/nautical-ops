/**
 * Vessel & Crew Safety Screen
 * Hub for safety-related features: Pre-Departure Checklist, Rules, Safety Equipment
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { COLORS, FONTS, SPACING, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';

const CATEGORIES = [
  { icon: '📍', label: 'Muster Station & Duties', nav: 'MusterStation' as const, enabled: true },
  { icon: '🦺', label: 'Safety Equipment', nav: 'SafetyEquipment' as const, enabled: true },
  { icon: '📜', label: 'Rules On-Board', nav: 'Rules' as const, enabled: true },
];

export const VesselCrewSafetyScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to use Vessel & Crew Safety.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]} contentContainerStyle={styles.content}>
      {CATEGORIES.map((category) => (
        <TouchableOpacity
          key={category.label}
          style={[styles.card, { backgroundColor: themeColors.surface }, !category.enabled && styles.cardDisabled]}
          onPress={() => category.enabled && category.nav && navigation.navigate(category.nav)}
          activeOpacity={category.enabled ? 0.8 : 1}
          disabled={!category.enabled}
        >
          <Text style={styles.cardIcon}>{category.icon}</Text>
          <Text style={[styles.cardLabel, { color: themeColors.textPrimary }, !category.enabled && { color: themeColors.textSecondary }]}>
            {category.label}
          </Text>
          {category.enabled ? (
            <Text style={[styles.cardChevron, { color: themeColors.textSecondary }]}>›</Text>
          ) : (
            <Text style={styles.comingSoon}>Coming soon</Text>
          )}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    borderRadius: 12,
    marginBottom: SPACING.md,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardDisabled: { opacity: 0.7 },
  cardIcon: { fontSize: FONTS['2xl'], marginRight: SPACING.lg },
  cardLabel: { flex: 1, fontSize: FONTS.lg, fontWeight: '600' },
  cardChevron: { fontSize: 24, fontWeight: '300' },
  comingSoon: {
    fontSize: FONTS.sm,
    color: COLORS.textTertiary,
  },
});
