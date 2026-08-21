/**
 * Vessel & Crew Safety Screen
 * Hub for safety-related features: Pre-Departure Checklist, Rules, Safety Equipment
 */

import React, { useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { COLORS, FONTS, SPACING, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { PageHeader } from '../components';
import { useAuthStore } from '../store';

const CATEGORIES = [
  { icon: '✅', label: 'Pre-Departure Checklist', nav: 'PreDepartureChecklist' as const, enabled: true },
  { icon: '📍', label: 'Muster Station & Duties', nav: 'MusterStation' as const, enabled: true },
  { icon: '🦺', label: 'Safety Equipment', nav: 'SafetyEquipment' as const, enabled: true },
  { icon: '📜', label: 'Rules On-Board', nav: 'Rules' as const, enabled: true },
  { icon: '💤', label: 'Hours of Rest', nav: 'HoursOfRest' as const, enabled: true },
  { icon: '📝', label: 'Watch Duties', nav: 'WatchDuties' as const, enabled: true },
];


const VESSEL_CREW_SAFETY_INFO = {
            title: 'Vessel & Crew Safety',
            description: 'Central hub for safety information and procedures.',
            features: [
              'Access muster stations and crew duties',
              'Review safety equipment records',
              'Read the rules on-board',
              'Run through the pre-departure checklist',
            ],
          };

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
    <View style={styles.pageWrap}>
      <PageHeader title="Vessel & Crew Safety" info={VESSEL_CREW_SAFETY_INFO} infoScreenKey="vessel_crew_safety" />
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
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
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
