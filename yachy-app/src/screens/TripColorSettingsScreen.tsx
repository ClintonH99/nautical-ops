/**
 * Trip Color Settings Screen
 * HOD can choose calendar colors for each visible trip type.
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import tripColorsService, { DEFAULT_COLORS } from '../services/tripColors';
import { Button, LoadingSpinner, PageHeader } from '../components';

type ColorKey = 'guest' | 'boss' | 'delivery' | 'yardPeriod';

const TRIP_LABELS: { key: ColorKey; label: string }[] = [
  { key: 'guest', label: 'Guest Trips' },
  { key: 'boss', label: 'Boss Trips' },
  { key: 'delivery', label: 'Delivery' },
];

export const TripColorSettingsScreen = () => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';

  const loadColors = useCallback(async () => {
    if (!vesselId) return;
    try {
      const c = await tripColorsService.getColors(vesselId);
      setColors(c);
    } catch (e) {
      console.error('Load trip colors error:', e);
    } finally {
      setLoading(false);
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadColors();
    }, [loadColors])
  );

  const handlePick = async (key: ColorKey, hex: string) => {
    if (!vesselId || !isHOD) return;
    setColors((prev) => ({ ...prev, [key]: hex }));
    setSaving(true);
    try {
      await tripColorsService.setColors(vesselId, { [key]: hex });
    } catch (e) {
      console.error('Save trip color error:', e);
      Alert.alert('Error', 'Could not save color');
      loadColors();
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    Alert.alert('Reset to defaults', 'Use the default colors for all trip types?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        onPress: async () => {
          if (!vesselId || !isHOD) return;
          setSaving(true);
          try {
            await tripColorsService.setColors(vesselId, {
              guest: DEFAULT_COLORS.guest,
              boss: DEFAULT_COLORS.boss,
              delivery: DEFAULT_COLORS.delivery,
              yardPeriod: DEFAULT_COLORS.yardPeriod,
            });
            setColors(DEFAULT_COLORS);
          } catch {
            Alert.alert('Error', 'Could not reset colors');
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  if (!isHOD) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Only HODs and Captain have access.
        </Text>
      </View>
    );
  }

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to edit trip colors.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <View style={styles.pageWrap}>
      <PageHeader title="Trip Colors" />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
      >
        <Text
          style={[
            styles.intro,
            { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
          ]}
        >
          Choose the calendar color for each trip type.
        </Text>

        {TRIP_LABELS.map(({ key, label }) => (
          <View
            key={key}
            style={[
              styles.section,
              { backgroundColor: themeColors.surface, borderColor: themeColors.border },
            ]}
          >
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <View style={[styles.currentColor, { backgroundColor: colors[key] }]} />
                <Text style={[styles.sectionLabel, { color: themeColors.textPrimary }]}>
                  {label}
                </Text>
              </View>
              <Text style={[styles.sectionHint, { color: themeColors.textSecondary }]}>
                Calendar color
              </Text>
            </View>
            <View style={styles.swatchRow}>
              {COLORS.tripColorSwatches.map((hex) => {
                const isSelected = colors[key] === hex;
                return (
                  <TouchableOpacity
                    key={hex}
                    style={[
                      styles.swatch,
                      { backgroundColor: hex },
                      isSelected && [
                        styles.swatchSelected,
                        { borderColor: themeColors.textPrimary },
                      ],
                    ]}
                    onPress={() => handlePick(key, hex)}
                    disabled={saving}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${hex} for ${label}`}
                    accessibilityState={{ selected: isSelected, disabled: saving }}
                  >
                    {isSelected ? (
                      <Ionicons name="checkmark" size={19} color={COLORS.white} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        <View style={styles.footer}>
          <Button
            title="Reset to defaults"
            onPress={handleReset}
            variant="outline"
            disabled={saving}
            style={styles.resetBtn}
          />
        </View>
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
  intro: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.md,
    lineHeight: 22,
  },
  section: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
  },
  currentColor: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  sectionLabel: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  sectionHint: { fontSize: FONTS.xs },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  swatch: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 3,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchSelected: {
    borderWidth: 3,
  },
  footer: {
    marginTop: SPACING.sm,
  },
  resetBtn: {},
});
