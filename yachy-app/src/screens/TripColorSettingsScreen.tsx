/**
 * Trip Color Settings Screen
 * HOD can choose calendar colors for each trip type (Guest, Boss, Delivery, Yard Period)
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import tripColorsService, { DEFAULT_COLORS } from '../services/tripColors';
import { Button } from '../components';

type ColorKey = 'guest' | 'boss' | 'delivery' | 'yardPeriod';

const TRIP_LABELS: { key: ColorKey; label: string; emoji: string }[] = [
  { key: 'guest', label: 'Guest Trips', emoji: '👥' },
  { key: 'boss', label: 'Boss Trips', emoji: '⚓' },
  { key: 'delivery', label: 'Delivery', emoji: '🚢' },
  { key: 'yardPeriod', label: 'Yard Period', emoji: '🔧' },
];

export const TripColorSettingsScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD';

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
    Alert.alert(
      'Reset to defaults',
      'Use the default colors for all trip types?',
      [
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
            } catch (e) {
              Alert.alert('Error', 'Could not reset colors');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  if (!isHOD) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Only HODs can edit trip colors.</Text>
      </View>
    );
  }

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to edit trip colors.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]} contentContainerStyle={styles.content}>
      <Text style={[styles.intro, { color: themeColors.textSecondary }]}>
        Choose a color for each trip type. These colors appear on the Upcoming Trips calendar.
      </Text>

      {TRIP_LABELS.map(({ key, label, emoji }) => (
        <View key={key} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: themeColors.textPrimary }]}>
            {emoji} {label}
          </Text>
          <View style={styles.swatchRow}>
            {COLORS.tripColorSwatches.map((hex) => {
              const isSelected = colors[key] === hex;
              return (
                <TouchableOpacity
                  key={hex}
                  style={[
                    styles.swatch,
                    { backgroundColor: hex },
                    isSelected && [styles.swatchSelected, { borderColor: themeColors.textPrimary }],
                  ]}
                  onPress={() => handlePick(key, hex)}
                  disabled={saving}
                />
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
  intro: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.xl,
    lineHeight: 22,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionLabel: {
    fontSize: FONTS.base,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderWidth: 3,
  },
  footer: {
    marginTop: SPACING.lg,
  },
  resetBtn: {},
});
