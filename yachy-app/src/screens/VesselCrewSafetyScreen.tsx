/**
 * Vessel & Crew Safety Screen
 * Hub for safety-related features: Pre-Departure Checklist, Rules, Safety Equipment
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { PageHeader } from '../components';
import { useAuthStore } from '../store';

const CATEGORIES = [
  {
    icon: 'checkbox-outline',
    label: 'Pre-Departure Checklist',
    nav: 'PreDepartureChecklist' as const,
    enabled: true,
  },
  {
    icon: 'location-outline',
    label: 'Muster Station & Duties',
    nav: 'MusterStation' as const,
    enabled: true,
  },
  {
    icon: 'help-buoy-outline',
    label: 'Safety Equipment',
    nav: 'SafetyEquipment' as const,
    enabled: true,
  },
  {
    icon: 'reader-outline',
    label: 'Rules On-Board',
    nav: 'Rules' as const,
    enabled: true,
  },
  {
    icon: 'moon-outline',
    label: 'Hours of Rest',
    nav: 'HoursOfRest' as const,
    enabled: true,
  },
  {
    icon: 'list-outline',
    label: 'Watch Duties',
    nav: 'WatchDuties' as const,
    enabled: true,
  },
] satisfies Array<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  nav:
    | 'PreDepartureChecklist'
    | 'MusterStation'
    | 'SafetyEquipment'
    | 'Rules'
    | 'HoursOfRest'
    | 'WatchDuties';
  enabled: boolean;
}>;
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
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to use Vessel & Crew Safety.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
      <PageHeader
        title="Vessel & Crew Safety"
        info={VESSEL_CREW_SAFETY_INFO}
        infoScreenKey="vessel_crew_safety"
      />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={[
            styles.sectionTitle,
            { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
          ]}
        >
          Safety Features
        </Text>
        <View style={styles.grid}>
          {CATEGORIES.map((category) => (
            <TouchableOpacity
              key={category.label}
              style={[
                styles.card,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: themeColors.border,
                },
                !category.enabled && styles.cardDisabled,
              ]}
              onPress={() => category.enabled && navigation.navigate(category.nav)}
              activeOpacity={category.enabled ? 0.8 : 1}
              disabled={!category.enabled}
              accessibilityRole="button"
              accessibilityLabel={category.label}
            >
              <View style={[styles.iconCircle, { backgroundColor: themeColors.accentSoft }]}>
                <Ionicons name={category.icon} size={24} color={themeColors.accent} />
              </View>
              <View style={styles.cardFooter}>
                <Text
                  style={[
                    styles.cardLabel,
                    { color: themeColors.textPrimary },
                    !category.enabled && { color: themeColors.textSecondary },
                  ]}
                >
                  {category.label}
                </Text>
                {category.enabled ? (
                  <Ionicons name="chevron-forward" size={19} color={themeColors.textSecondary} />
                ) : (
                  <Text style={[styles.comingSoon, { color: themeColors.textMuted }]}>Soon</Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
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
  sectionTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    marginBottom: SPACING.md,
    paddingHorizontal: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  card: {
    width: '47.5%',
    minHeight: 134,
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
  },
  cardDisabled: { opacity: 0.7 },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: BORDER_RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.xs,
  },
  cardLabel: {
    flex: 1,
    fontSize: FONTS.sm,
    lineHeight: 19,
    fontWeight: '700',
  },
  comingSoon: {
    fontSize: FONTS.xs,
  },
});
