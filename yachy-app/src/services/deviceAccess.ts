import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const FALLBACK_DEVICE_ID_KEY = 'nautical_ops_installation_device_id';

export const DEVICE_LIMIT_MESSAGE =
  'This account is already registered on 2 devices. Sign out from an existing device or contact support@nautical-ops.com.';

export type DeviceAccessResult =
  | { state: 'allowed'; activeDeviceCount: number }
  | { state: 'limit_reached'; activeDeviceCount: number }
  | { state: 'unavailable'; activeDeviceCount: null };

async function getFallbackInstallationId(): Promise<string> {
  const existing = await AsyncStorage.getItem(FALLBACK_DEVICE_ID_KEY);
  if (existing) return existing;

  const created = Crypto.randomUUID();
  await AsyncStorage.setItem(FALLBACK_DEVICE_ID_KEY, created);
  return created;
}

async function getPlatformDeviceId(): Promise<string> {
  try {
    if (Platform.OS === 'ios') {
      const id = await Application.getIosIdForVendorAsync();
      if (id) return id;
    }
    if (Platform.OS === 'android') {
      const id = Application.getAndroidId();
      if (id) return id;
    }
  } catch {
    // Expo Go/simulators may not expose the native identifier. The persisted
    // installation identifier below keeps development and web usable.
  }
  return getFallbackInstallationId();
}

export async function getCurrentDeviceFingerprint(): Promise<string> {
  const rawId = await getPlatformDeviceId();
  const appId = Application.applicationId ?? 'nautical-ops-web';
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    [appId, Platform.OS, rawId].join(':')
  );
}

function getDeviceLabel(): string {
  if (Platform.OS === 'web') return 'Web browser';
  return Device.modelName || (Platform.OS === 'ios' ? 'Apple device' : 'Android device');
}

function isConnectivityError(error: any): boolean {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    message.includes('network request failed') ||
    message.includes('network error') ||
    message.includes('fetch failed') ||
    message.includes('timeout')
  );
}

/**
 * Claim or refresh this account's device slot.
 *
 * Unknown/network states deliberately fail open: loss of connectivity must
 * never be mistaken for a device-limit violation.
 */
export async function registerCurrentDevice(): Promise<DeviceAccessResult> {
  try {
    const fingerprint = await getCurrentDeviceFingerprint();
    const { data, error } = await supabase.rpc('register_user_device', {
      p_device_fingerprint: fingerprint,
      p_platform: Platform.OS,
      p_device_name: getDeviceLabel(),
    });

    if (error) {
      if (__DEV__ && !isConnectivityError(error)) {
        console.warn('[Device access] Registration unavailable:', error.message);
      }
      return { state: 'unavailable', activeDeviceCount: null };
    }

    const result = data as
      | { allowed?: boolean; active_device_count?: number }
      | null
      | undefined;
    const activeDeviceCount = Number(result?.active_device_count ?? 0);
    return result?.allowed
      ? { state: 'allowed', activeDeviceCount }
      : { state: 'limit_reached', activeDeviceCount };
  } catch (error) {
    if (__DEV__ && !isConnectivityError(error)) {
      console.warn('[Device access] Registration failed:', error);
    }
    return { state: 'unavailable', activeDeviceCount: null };
  }
}

/** Release this installation's slot during an intentional user sign-out. */
export async function releaseCurrentDevice(): Promise<void> {
  try {
    const { error } = await supabase.rpc('revoke_current_device');
    if (error && __DEV__ && !isConnectivityError(error)) {
      console.warn('[Device access] Could not release device slot:', error.message);
    }
  } catch (error) {
    if (__DEV__ && !isConnectivityError(error)) {
      console.warn('[Device access] Could not release device slot:', error);
    }
  }
}
