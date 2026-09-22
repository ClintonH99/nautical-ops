/**
 * Shopping List Category Screen
 * Choose between General Shopping or Trip Shopping before viewing/creating lists
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PageHeader } from '../components';
import { BORDER_RADIUS, FONTS, SPACING, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';

const CATEGORIES = [
  {
    icon: 'cart-outline' as const,
    label: 'General Shopping',
    description: 'Everyday vessel supplies',
    listType: 'general' as const,
  },
  {
    icon: 'boat-outline' as const,
    label: 'Trip Shopping',
    description: 'Reusable and trip-specific lists',
    listType: 'trip' as const,
  },
];

const SHOPPING_INFO = {
  title: 'Shopping',
  description: 'Manage shopping lists organized by category.',
  features: [
    'Browse shopping lists by category',
    'Add items with quantities and notes',
    'Check off items as they are purchased',
    'Keep provisioning organized across departments',
  ],
};

export const ShoppingListCategoryScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to use Shopping List.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Shopping" info={SHOPPING_INFO} infoScreenKey="shopping" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {CATEGORIES.map((category) => (
          <TouchableOpacity
            key={category.listType}
            style={[
              styles.card,
              { backgroundColor: themeColors.surface, borderColor: themeColors.border },
            ]}
            onPress={() => navigation.navigate('ShoppingList', { listType: category.listType })}
            activeOpacity={0.8}
          >
            <View style={[styles.cardIcon, { backgroundColor: themeColors.controlSelected }]}>
              <Ionicons name={category.icon} size={26} color={themeColors.textOnAccent} />
            </View>
            <View style={styles.cardCopy}>
              <Text style={[styles.cardLabel, { color: themeColors.textPrimary }]}>
                {category.label}
              </Text>
              <Text style={[styles.cardDescription, { color: themeColors.textSecondary }]}>
                {category.description}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={themeColors.accent} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
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
    minHeight: 104,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.md,
  },
  cardIcon: {
    width: 52,
    height: 52,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.lg,
  },
  cardCopy: {
    flex: 1,
  },
  cardLabel: {
    fontSize: FONTS.lg,
    fontWeight: '600',
  },
  cardDescription: {
    fontSize: FONTS.sm,
    marginTop: SPACING.xs,
  },
});
