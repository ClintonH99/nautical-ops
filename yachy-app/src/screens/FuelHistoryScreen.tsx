import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PageHeader } from '../components';
import { BORDER_RADIUS, COLORS, FONTS, SIZES, SPACING } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

interface FuelHistoryNavigation {
  navigate: (screen: 'FuelLog' | 'FuelTransfers') => void;
}

interface FuelHistoryScreenProps {
  navigation: FuelHistoryNavigation;
}

interface HistoryOptionProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  onPress: () => void;
}

const HistoryOption = ({ icon, title, description, onPress }: HistoryOptionProps) => {
  const themeColors = useThemeColors();

  return (
    <TouchableOpacity
      style={[
        styles.optionCard,
        { backgroundColor: themeColors.surface, borderColor: themeColors.border },
      ]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={[styles.optionIcon, { backgroundColor: themeColors.accentSoft }]}>
        <Ionicons name={icon} size={26} color={themeColors.accent} />
      </View>
      <View style={styles.optionCopy}>
        <Text style={[styles.optionTitle, { color: themeColors.textPrimary }]}>{title}</Text>
        <Text style={[styles.optionDescription, { color: themeColors.textSecondary }]}>
          {description}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={themeColors.textSecondary} />
    </TouchableOpacity>
  );
};

export const FuelHistoryScreen = ({ navigation }: FuelHistoryScreenProps) => {
  const themeColors = useThemeColors();

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Fueling History" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.introduction, { color: themeColors.textSecondary }]}>
          View the vessel&apos;s refuelling receipts and tank-to-tank fuel transfer records.
        </Text>

        <HistoryOption
          icon="receipt-outline"
          title="Fuel Receipts"
          description="Review refuelling entries, tank allocations, prices, dates and locations."
          onPress={() => navigation.navigate('FuelLog')}
        />
        <HistoryOption
          icon="swap-horizontal-outline"
          title="Fuel Transfers"
          description="Review the history of fuel moved between the vessel&apos;s tanks."
          onPress={() => navigation.navigate('FuelTransfers')}
        />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  introduction: {
    fontSize: FONTS.base,
    lineHeight: 23,
    marginBottom: SPACING.lg,
  },
  optionCard: {
    minHeight: 116,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 2,
  },
  optionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionCopy: { flex: 1 },
  optionTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  optionDescription: {
    fontSize: FONTS.sm,
    lineHeight: 20,
  },
});
