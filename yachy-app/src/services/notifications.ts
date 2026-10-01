/**
 * Push Notifications Service
 * Registers for Expo push notifications and stores token in Supabase
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';
import { getCurrentDeviceFingerprint } from './deviceAccess';

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
    if (__DEV__) console.log('Push notifications require a physical device');
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

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      if (__DEV__) console.log('Push permission not granted');
      return null;
    }
  }

  return getExpoPushToken();
}

async function getExpoPushToken(): Promise<string> {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  try {
    return (
      await Notifications.getExpoPushTokenAsync({
        projectId: projectId || undefined,
      })
    ).data;
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

function isMissingDevicePushStorage(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = String(candidate?.code ?? '');
  const message = String(candidate?.message ?? '').toLowerCase();
  return (
    code === '42883' ||
    code === '42703' ||
    code === 'PGRST202' ||
    code === 'PGRST204' ||
    message.includes('could not find the function public.set_current_device_push_token') ||
    message.includes('could not find the function public.clear_current_device_push_token') ||
    (message.includes('expo_push_token') &&
      (message.includes('does not exist') || message.includes('schema cache')))
  );
}

async function saveLegacyPushToken(userId: string, token: string): Promise<void> {
  const { data, error } = await supabase
    .from('users')
    .update({ push_token: token })
    .eq('id', userId)
    .select('id');
  requireAffectedRows(data, error, 'Saving the push token');
}

export async function savePushToken(userId: string, token: string): Promise<void> {
  const fingerprint = await getCurrentDeviceFingerprint();
  const { data: saved, error } = await supabase.rpc('set_current_device_push_token', {
    p_device_fingerprint: fingerprint,
    p_expo_push_token: token,
  });

  if (error) {
    // Existing installations remain usable while the multi-device migration
    // and Edge Function are rolled out together.
    if (isMissingDevicePushStorage(error)) {
      await saveLegacyPushToken(userId, token);
      return;
    }
    throw error;
  }

  // A refresh must never undo an explicit device opt-out, including when
  // the switch is turned off while token registration is in flight.
  if (saved === false) return;

  // The RPC also maintains the legacy token inside the same device lock.
  // A separate write here would race with the user's OFF action.
}

/** Only the user's explicit ON action may clear a persisted device opt-out. */
export async function enablePushForCurrentDevice(userId: string, token: string): Promise<void> {
  const fingerprint = await getCurrentDeviceFingerprint();
  const { error } = await supabase.rpc('enable_current_device_push', {
    p_device_fingerprint: fingerprint,
    p_expo_push_token: token,
  });
  if (error) throw error;
  // Both the preference and token are committed atomically by the RPC.
}

export async function clearPushToken(userId: string): Promise<void> {
  const fingerprint = await getCurrentDeviceFingerprint();
  const { data: currentDevice, error: lookupError } = await supabase
    .from('user_devices')
    .select('expo_push_token, push_enabled')
    .eq('user_id', userId)
    .eq('device_fingerprint', fingerprint)
    .is('revoked_at', null)
    .maybeSingle();

  if (lookupError && !isMissingDevicePushStorage(lookupError)) throw lookupError;

  const { error } = await supabase.rpc('clear_current_device_push_token', {
    p_device_fingerprint: fingerprint,
  });

  if (error) {
    if (!isMissingDevicePushStorage(error)) throw error;
    const { data, error: legacyError } = await supabase
      .from('users')
      .update({ push_token: null })
      .eq('id', userId)
      .select('id');
    requireAffectedRows(data, legacyError, 'Clearing the push token');
    return;
  }

  const previousToken = currentDevice?.expo_push_token;
  if (previousToken) {
    await supabase
      .from('users')
      .update({ push_token: null })
      .eq('id', userId)
      .eq('push_token', previousToken);
  }
}

export async function isPushEnabledForCurrentDevice(userId: string): Promise<boolean> {
  const fingerprint = await getCurrentDeviceFingerprint();
  const { data, error } = await supabase
    .from('user_devices')
    .select('expo_push_token, push_enabled')
    .eq('user_id', userId)
    .eq('device_fingerprint', fingerprint)
    .is('revoked_at', null)
    .maybeSingle();

  if (!error) return data?.push_enabled !== false && !!data?.expo_push_token;
  if (!isMissingDevicePushStorage(error)) throw error;

  const { data: legacy, error: legacyError } = await supabase
    .from('users')
    .select('push_token')
    .eq('id', userId)
    .single();
  if (legacyError) throw legacyError;
  return !!legacy?.push_token;
}

/** Refresh an already-approved token without showing an OS permission prompt. */
export async function syncPushTokenForCurrentDevice(userId: string): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  const fingerprint = await getCurrentDeviceFingerprint();
  const { data: device, error } = await supabase
    .from('user_devices')
    .select('push_enabled')
    .eq('user_id', userId)
    .eq('device_fingerprint', fingerprint)
    .is('revoked_at', null)
    .maybeSingle();
  // Fail closed if the saved preference cannot be read.
  if (error || !device || device.push_enabled === false) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  const token = await getExpoPushToken();
  await savePushToken(userId, token);
}

export async function getNotificationPreferences(userId: string): Promise<Record<string, boolean>> {
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
      crewLeave: true,
    };
  }
  return { ...data.notification_preferences } as Record<string, boolean>;
}

export async function saveNotificationPreference(
  userId: string,
  key: string,
  enabled: boolean
): Promise<void> {
  const { data: current, error: readError } = await supabase
    .from('users')
    .select('notification_preferences')
    .eq('id', userId)
    .single();

  if (readError) throw readError;

  const prefs = (current?.notification_preferences ?? {}) as Record<string, boolean>;
  const updated = { ...prefs, [key]: enabled };

  const { data, error } = await supabase
    .from('users')
    .update({ notification_preferences: updated })
    .eq('id', userId)
    .select('id');
  requireAffectedRows(data, error, 'Saving the notification preference');
}
