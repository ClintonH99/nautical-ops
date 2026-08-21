/**
 * Vessel Logs Screen
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

const LOG_CATEGORIES = [
  {
    icon: '🗑️',
    label: 'General Waste',
    route: 'GeneralWasteLog',
  },
  {
    icon: '⛽',
    label: 'Fuel Log',
    route: 'FuelLog',
  },
  {
    icon: '🚿',
    label: 'Pump Out Log',
    route: 'PumpOutLog',
  },
];


const VESSEL_LOGS_INFO = {
            title: 'Vessel Logs',
            description: 'Record fuel, waste, and pump-out logs.',
            features: [
              'Log fuel bunkering and consumption',
              'Track general waste disposal',
              'Record pump-out events',
              'Maintain compliant vessel records',
            ],
          };

export const VesselLogsScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  return (
    <View style={styles.pageWrap}>
      <PageHeader title="Vessel Logs" info={VESSEL_LOGS_INFO} infoScreenKey="vessel_logs" />
      <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]} contentContainerStyle={styles.content}>
        {LOG_CATEGORIES.map((category) => (
          <TouchableOpacity
            key={category.route}
            style={[styles.card, { backgroundColor: themeColors.surface }]}
            onPress={() => navigation.navigate(category.route)}
            activeOpacity={0.8}
          >
            <Text style={styles.cardIcon}>{category.icon}</Text>
            <Text style={[styles.cardLabel, { color: themeColors.textPrimary }]}>{category.label}</Text>
            <Text style={[styles.cardChevron, { color: themeColors.textSecondary }]}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
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
