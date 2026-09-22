/**
 * Vessel Logs Screen
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { PageHeader } from '../components';

const LOG_CATEGORIES = [
  {
    icon: 'trash-outline',
    label: 'General Waste',
    description: 'Record waste disposal and quantities',
    route: 'GeneralWasteLog',
  },
  {
    icon: 'speedometer-outline',
    label: 'Fuel',
    description: 'Fuel receipts, transfers and fueling history',
    route: 'FuelInventory',
  },
  {
    icon: 'water-outline',
    label: 'Discharge Log',
    description: 'Record discharge and pump-out events',
    route: 'PumpOutLog',
  },
] satisfies Array<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  route: 'GeneralWasteLog' | 'FuelInventory' | 'PumpOutLog';
}>;

const VESSEL_LOGS_INFO = {
  title: 'Vessel Logs',
  description: 'Record fuel, waste, and discharge logs.',
  features: [
    'Track calculated tank inventory, bunkering, soundings and transfers',
    'Track general waste disposal',
    'Record discharge events',
    'Maintain compliant vessel records',
  ],
};

export const VesselLogsScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  return (
    <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Vessel Logs" info={VESSEL_LOGS_INFO} infoScreenKey="vessel_logs" />
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
          Log Categories
        </Text>
        {LOG_CATEGORIES.map((category) => (
          <TouchableOpacity
            key={category.route}
            style={[
              styles.card,
              {
                backgroundColor: themeColors.surface,
                borderColor: themeColors.border,
              },
            ]}
            onPress={() => navigation.navigate(category.route)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={category.label}
          >
            <View style={[styles.iconCircle, { backgroundColor: themeColors.accentSoft }]}>
              <Ionicons name={category.icon} size={23} color={themeColors.accent} />
            </View>
            <View style={styles.cardCopy}>
              <Text style={[styles.cardLabel, { color: themeColors.textPrimary }]}>
                {category.label}
              </Text>
              <Text style={[styles.cardDescription, { color: themeColors.textSecondary }]}>
                {category.description}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={21} color={themeColors.textSecondary} />
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
  sectionTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    marginBottom: SPACING.md,
    paddingHorizontal: 2,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 94,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: BORDER_RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  cardCopy: {
    flex: 1,
    paddingRight: SPACING.sm,
  },
  cardLabel: {
    fontSize: FONTS.base,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  cardDescription: {
    fontSize: FONTS.sm,
    lineHeight: 19,
  },
});
