/**
 * Notification Settings Screen
 * Enable/disable push notifications and choose what to receive
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import {
  registerForPushNotificationsAsync,
  savePushToken,
  clearPushToken,
  getNotificationPreferences,
  saveNotificationPreference,
} from '../services/notifications';
import { supabase } from '../services/supabase';
import * as Device from 'expo-device';
import type { NotificationPreferenceKey } from '../types';

const PREFERENCE_LABELS: Record<NotificationPreferenceKey, string> = {
  tasks: 'Tasks',
  trips: 'Trips',
  preDeparture: 'Pre-Departure Checklist',
  maintenance: 'Maintenance',
  yardJobs: 'Yard Period Jobs',
  watchSchedule: 'Watch Schedule',
};

const PREFERENCE_ORDER: NotificationPreferenceKey[] = [
  'tasks',
  'trips',
  'preDeparture',
  'maintenance',
  'yardJobs',
  'watchSchedule',
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
          const [tokenRes, prefsRes] = await Promise.all([
            supabase.from('users').select('push_token').eq('id', user.id).single(),
            getNotificationPreferences(user.id),
          ]);
          if (mounted) {
            setEnabled(!!tokenRes.data?.push_token);
            setPreferences(prefsRes);
          }
        } catch {
          if (mounted) setEnabled(false);
        } finally {
          if (mounted) setChecking(false);
        }
      };

      check();
      return () => { mounted = false; };
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
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: themeColors.textPrimary }]}>Notifications</Text>
      <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
        Receive push notifications for tasks, trips, and important updates.
      </Text>

      <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: themeColors.textPrimary }]}>Push notifications</Text>
          {loading ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Switch
              value={enabled}
              onValueChange={handleToggle}
              trackColor={{ false: COLORS.gray200, true: COLORS.primary }}
              thumbColor={COLORS.white}
            />
          )}
        </View>
        {enabled && (
          <Text style={[styles.statusText, { color: themeColors.textSecondary }]}>You will receive push notifications.</Text>
        )}
      </View>

      {enabled && (
        <View style={styles.preferencesSection}>
          <Text style={[styles.preferencesTitle, { color: themeColors.textPrimary }]}>What to receive</Text>
          <Text style={[styles.preferencesSubtitle, { color: themeColors.textSecondary }]}>
            Choose which updates you want to be notified about.
          </Text>
          <View style={[styles.preferencesCard, { backgroundColor: themeColors.surface }]}>
            {PREFERENCE_ORDER.map((key, index) => (
              <View
                key={key}
                style={[
                  styles.preferenceRow,
                  index < PREFERENCE_ORDER.length - 1 && styles.preferenceRowBorder,
                ]}
              >
                <Text style={[styles.preferenceLabel, { color: themeColors.textPrimary }]}>{PREFERENCE_LABELS[key]}</Text>
                <Switch
                  value={preferences[key] ?? true}
                  onValueChange={(v) => handlePreferenceToggle(key, v)}
                  trackColor={{ false: COLORS.gray200, true: COLORS.primary }}
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
  );
};

const styles = StyleSheet.create({
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
  title: {
    fontSize: FONTS['2xl'],
    fontWeight: 'bold',
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.xl,
  },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  statusText: {
    fontSize: FONTS.sm,
    marginTop: SPACING.sm,
  },
  preferencesSection: {
    marginTop: SPACING.xl,
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
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  preferenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.lg,
  },
  preferenceRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  preferenceLabel: { fontSize: FONTS.base },
  warning: {
    marginTop: SPACING.xl,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
  },
  warningText: { fontSize: FONTS.sm },
});
