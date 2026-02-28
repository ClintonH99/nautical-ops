/**
 * Push Notifications Service
 * Registers for Expo push notifications and stores token in Supabase
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Show notifications when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'General',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0066CC',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
    if (status !== 'granted') {
      console.log('Push permission not granted');
      return null;
    }
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

  try {
    const token = (
      await Notifications.getExpoPushTokenAsync({
        projectId: projectId || undefined,
      })
    ).data;
    return token;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('projectId') || msg.includes('project_id')) {
      const err = new Error(
        'PROJECT_ID_REQUIRED: Run "npx eas init" to set up push notifications, or add extra.eas.projectId to app.json.'
      ) as Error & { code?: string };
      err.code = 'PROJECT_ID_REQUIRED';
      throw err;
    }
    throw e;
  }
}

export async function savePushToken(userId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ push_token: token })
    .eq('id', userId);

  if (error) {
    console.error('Save push token error:', error);
    throw error;
  }
}

export async function clearPushToken(userId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ push_token: null })
    .eq('id', userId);

  if (error) {
    console.error('Clear push token error:', error);
    throw error;
  }
}

export async function getNotificationPreferences(
  userId: string
): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from('users')
    .select('notification_preferences')
    .eq('id', userId)
    .single();

  if (error || !data?.notification_preferences) {
    return {
      tasks: true,
      trips: true,
      preDeparture: true,
      maintenance: true,
      yardJobs: true,
      watchSchedule: true,
    };
  }
  return { ...data.notification_preferences } as Record<string, boolean>;
}

export async function saveNotificationPreference(
  userId: string,
  key: string,
  enabled: boolean
): Promise<void> {
  const { data: current } = await supabase
    .from('users')
    .select('notification_preferences')
    .eq('id', userId)
    .single();

  const prefs = (current?.notification_preferences ?? {}) as Record<string, boolean>;
  const updated = { ...prefs, [key]: enabled };

  const { error } = await supabase
    .from('users')
    .update({ notification_preferences: updated })
    .eq('id', userId);

  if (error) {
    console.error('Save notification preference error:', error);
    throw error;
  }
}
