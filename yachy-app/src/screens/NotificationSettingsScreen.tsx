import { LoadingSpinner as ActivityIndicator } from '../components/LoadingSpinner';
/**
 * Notification Settings Screen
 * Enable/disable push notifications and choose what to receive
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import {
  registerForPushNotificationsAsync,
  savePushToken,
  clearPushToken,
  isPushEnabledForCurrentDevice,
  getNotificationPreferences,
  saveNotificationPreference,
} from '../services/notifications';
import * as Device from 'expo-device';
import type { NotificationPreferenceKey } from '../types';
import { LoadingSpinner, PageHeader } from '../components';

const PREFERENCE_LABELS: Record<NotificationPreferenceKey, string> = {
  tasks: 'Tasks',
  trips: 'Trips',
  preDeparture: 'Pre-Departure Checklist',
  maintenance: 'Maintenance',
  yardJobs: 'Shipyard List Jobs',
  watchSchedule: 'Watch Schedule',
  crewLeave: 'Crew Leave',
};

const PREFERENCE_ORDER: NotificationPreferenceKey[] = [
  'tasks',
  'trips',
  'preDeparture',
  'maintenance',
  'yardJobs',
  'watchSchedule',
  'crewLeave',
];

export const NotificationSettingsScreen = () => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [enabled, setEnabled] = useState(false);
  const [preferences, setPreferences] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;

      const check = async () => {
        if (!user?.id) {
          if (mounted) setChecking(false);
          return;
        }
        try {
          const [deviceEnabled, prefsRes] = await Promise.all([
            isPushEnabledForCurrentDevice(user.id),
            getNotificationPreferences(user.id),
          ]);
          if (mounted) {
            setEnabled(deviceEnabled);
            setPreferences(prefsRes);
          }
        } catch {
          if (mounted) setEnabled(false);
        } finally {
          if (mounted) setChecking(false);
        }
      };

      check();
      return () => {
        mounted = false;
      };
    }, [user?.id])
  );

  const handleToggle = async (value: boolean) => {
    if (!user?.id) return;

    setLoading(true);
    try {
      if (value) {
        if (!Device.isDevice) {
          Alert.alert(
            'Physical device required',
            'Push notifications only work on a physical device, not on simulators.'
          );
          setLoading(false);
          return;
        }

        const token = await registerForPushNotificationsAsync();
        if (token) {
          await savePushToken(user.id, token);
          setEnabled(true);
        } else {
          Alert.alert(
            'Permission denied',
            'Please enable notifications in your device Settings to receive push notifications.'
          );
        }
      } else {
        await clearPushToken(user.id);
        setEnabled(false);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (
        e?.code === 'PROJECT_ID_REQUIRED' ||
        msg.includes('projectId') ||
        msg.includes('project_id')
      ) {
        Alert.alert(
          'Setup required',
          'Push notifications need EAS configuration. Run "npx eas init" in your project, then restart the app.'
        );
      } else {
        console.error('Toggle notifications error:', e);
        Alert.alert('Error', 'Could not update notification settings. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePreferenceToggle = async (key: NotificationPreferenceKey, value: boolean) => {
    if (!user?.id) return;
    setPreferences((p) => ({ ...p, [key]: value }));
    try {
      await saveNotificationPreference(user.id, key, value);
    } catch (e) {
      console.error('Save preference error:', e);
      setPreferences((p) => ({ ...p, [key]: !value })); // revert on error
      Alert.alert('Error', 'Could not save preference. Please try again.');
    }
  };

  if (checking) {
    return (
      <View style={[styles.centered, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Notifications" />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: themeColors.textSecondary }]}>
          Receive push notifications for tasks, trips and important updates.
        </Text>

        <View
          style={[
            styles.card,
            {
              backgroundColor: themeColors.surface,
              borderColor: themeColors.border,
              borderWidth: 1,
            },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowLabel, { color: themeColors.textPrimary }]}>
                Push notifications
              </Text>
              <Text style={[styles.rowDetail, { color: themeColors.textSecondary }]}>
                Notifications on this device
              </Text>
            </View>
            {loading ? (
              <ActivityIndicator size="small" color={themeColors.accent} />
            ) : (
              <Switch
                value={enabled}
                onValueChange={handleToggle}
                trackColor={{
                  false: themeColors.isDark ? themeColors.borderStrong : COLORS.gray200,
                  true: themeColors.isDark ? themeColors.controlSelected : COLORS.primary,
                }}
                thumbColor={COLORS.white}
              />
            )}
          </View>
          {enabled && (
            <View style={styles.statusRow}>
              <Ionicons name="checkmark-circle-outline" size={17} color={COLORS.success} />
              <Text style={styles.statusText}>Enabled on this device</Text>
            </View>
          )}
        </View>

        {enabled && (
          <View style={styles.preferencesSection}>
            <Text
              style={[
                styles.preferencesTitle,
                { color: themeColors.isDark ? COLORS.white : COLORS.primary },
              ]}
            >
              What to receive
            </Text>
            <Text style={[styles.preferencesSubtitle, { color: themeColors.textSecondary }]}>
              Choose which updates you want to be notified about.
            </Text>
            <View
              style={[
                styles.preferencesCard,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: themeColors.border,
                  borderWidth: 1,
                },
              ]}
            >
              {PREFERENCE_ORDER.map((key, index) => (
                <View
                  key={key}
                  style={[
                    styles.preferenceRow,
                    index < PREFERENCE_ORDER.length - 1 && {
                      borderBottomWidth: 1,
                      borderBottomColor: themeColors.border,
                    },
                  ]}
                >
                  <Text style={[styles.preferenceLabel, { color: themeColors.textPrimary }]}>
                    {PREFERENCE_LABELS[key]}
                  </Text>
                  <Switch
                    value={preferences[key] ?? true}
                    onValueChange={(v) => handlePreferenceToggle(key, v)}
                    trackColor={{
                      false: themeColors.isDark ? themeColors.borderStrong : COLORS.gray200,
                      true: themeColors.isDark ? themeColors.controlSelected : COLORS.primary,
                    }}
                    thumbColor={COLORS.white}
                  />
                </View>
              ))}
            </View>
          </View>
        )}

        {!Device.isDevice && (
          <View style={[styles.warning, { backgroundColor: themeColors.surfaceAlt }]}>
            <Text style={[styles.warningText, { color: themeColors.textSecondary }]}>
              Use a physical device to test push notifications. They do not work on simulators.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  intro: {
    fontSize: FONTS.sm,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowLabel: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  rowDetail: { fontSize: FONTS.sm, marginTop: 2 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.sm,
  },
  statusText: {
    fontSize: FONTS.sm,
    color: COLORS.success,
  },
  preferencesSection: {
    marginTop: SPACING.md,
  },
  preferencesTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  preferencesSubtitle: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.md,
  },
  preferencesCard: {
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
  },
  preferenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  preferenceLabel: { fontSize: FONTS.base },
  warning: {
    marginTop: SPACING.xl,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
  },
  warningText: { fontSize: FONTS.sm },
});
