/**
 * Maintenance Home Screen
 * Hub for maintenance-related features: Maintenance Log, Yard Period, Vessel Logs, Contractor Database
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { COLORS, FONTS, SPACING, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';

const CATEGORIES = [
  { icon: '📋', label: 'Maintenance Log', nav: 'MaintenanceLog' as const },
  { icon: '🏗️', label: 'Yard Period', nav: 'YardPeriodTrips' as const },
  { icon: '📊', label: 'Vessel Logs', nav: 'VesselLogs' as const },
  { icon: '👷', label: 'Contractor Database', nav: 'ContractorDatabase' as const },
];


export const MaintenanceHomeScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to use Maintenance.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]} contentContainerStyle={styles.content}>
      <View style={styles.cardsContainer}>
      {CATEGORIES.map((category) => (
        <TouchableOpacity
          key={category.nav}
          style={[styles.card, { backgroundColor: themeColors.surface }]}
          onPress={() => navigation.navigate(category.nav)}
          activeOpacity={0.8}
        >
          <Text style={styles.cardIcon}>{category.icon}</Text>
          <Text style={[styles.cardLabel, { color: themeColors.textPrimary }]}>{category.label}</Text>
          <Text style={[styles.cardChevron, { color: themeColors.textSecondary }]}>›</Text>
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
    paddingBottom: SIZES.bottomScrollPadding,
  },
  cardsContainer: {
    padding: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  message: {
    fontSize: FONTS.base,
    textAlign: 'center',
  },
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
  cardIcon: {
    fontSize: FONTS['2xl'],
    marginRight: SPACING.lg,
  },
  cardLabel: {
    flex: 1,
    fontSize: FONTS.lg,
    fontWeight: '600',
  },
  cardChevron: {
    fontSize: 24,
    fontWeight: '300',
  },
});
