/**
 * Shopping List Category Screen
 * Choose between General Shopping or Trip Shopping before viewing/creating lists
 */

import React, { useLayoutEffect } from 'react';
import { InfoModal } from '../components/InfoModal';
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
  {
    icon: '🛒',
    label: 'General Shopping',
    listType: 'general' as const,
  },
  {
    icon: '✈️',
    label: 'Trip Shopping',
    listType: 'trip' as const,
  },
];

export const ShoppingListCategoryScreen = ({ navigation }: any) => {
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <InfoModal
          screenKey="shopping"
          autoShow={false}
          content={{
            title: 'Shopping',
            description: 'Manage shopping lists organized by category.',
            features: [
              'Browse shopping lists by category',
              'Add items with quantities and notes',
              'Check off items as they are purchased',
              'Keep provisioning organized across departments',
            ],
          }}
        />
      ),
    });
  }, [navigation]);
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to use Shopping List.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]} contentContainerStyle={styles.content}>
      {CATEGORIES.map((category) => (
        <TouchableOpacity
          key={category.listType}
          style={[styles.card, { backgroundColor: themeColors.surface }]}
          onPress={() => navigation.navigate('ShoppingList', { listType: category.listType })}
          activeOpacity={0.8}
        >
          <Text style={styles.cardIcon}>{category.icon}</Text>
          <Text style={[styles.cardLabel, { color: themeColors.textPrimary }]}>{category.label}</Text>
          <Text style={[styles.cardChevron, { color: themeColors.textSecondary }]}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
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
