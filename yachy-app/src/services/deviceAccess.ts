import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { getBrowserInstallationId, getBrowserDeviceLabel } from '../utils/browserDeviceIdentity';
import { isBrowserSessionVisible, recordBrowserSessionResult } from './browserSessionLease';

const FALLBACK_DEVICE_ID_KEY = 'nautical_ops_installation_device_id';
let pendingInstallationId: Promise<string> | undefined;

export const DEVICE_LIMIT_MESSAGE =
  'This account already has 2 saved devices. Use Manage Devices on an approved device, or select Lost Device? below to recover access.';
export const DEVICE_SESSION_REVOKED_MESSAGE =
  'This device session was removed or replaced. Please sign in again. If both device slots are occupied, use Lost Device? to recover access.';

export type DeviceAccessResult = (
  | { state: 'allowed'; activeDeviceCount: number }
  | { state: 'limit_reached'; activeDeviceCount: number }
  | { state: 'session_revoked'; activeDeviceCount: null }
  | { state: 'unavailable'; activeDeviceCount: null }
) & { mode?: 'active_sessions' | 'saved_browsers' };

async function getFallbackInstallationId(): Promise<string> {
  if (Platform.OS === 'web') return getBrowserInstallationId(() => Crypto.randomUUID());
  if (!pendingInstallationId) {
    pendingInstallationId = (async () => {
      const existing = await AsyncStorage.getItem(FALLBACK_DEVICE_ID_KEY);
      if (existing) return existing;
      const created = Crypto.randomUUID();
      await AsyncStorage.setItem(FALLBACK_DEVICE_ID_KEY, created);
      return created;
    })().finally(() => {
      pendingInstallationId = undefined;
    });
  }
  return pendingInstallationId;
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
  const appId =
    Platform.OS === 'web' ? 'nautical-ops-web' : (Application.applicationId ?? 'nautical-ops-web');
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    [appId, Platform.OS, rawId].join(':')
  );
}

export function getDeviceLabel(): string {
  if (Platform.OS === 'web') {
    return typeof navigator === 'undefined'
      ? 'Web browser'
      : getBrowserDeviceLabel(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  }
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
 * Unknown/network states are not device-limit violations. The database still
 * denies protected data unless this session has a registered device slot.
 */
export async function registerCurrentDevice(): Promise<DeviceAccessResult> {
  // Token refresh/realtime callbacks may run in a hidden tab. They must not
  // renew a foreground lease or sign the user out when the lease expires.
  if (Platform.OS === 'web' && !isBrowserSessionVisible())
    return { state: 'unavailable', activeDeviceCount: null };
  const requestStartedAt = Date.now();
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
      | {
          allowed?: boolean;
          active_device_count?: number;
          reason?: string;
          mode?: string;
          user_id?: string;
          lease_expires_at?: string;
          server_time?: string;
        }
      | null
      | undefined;
    const mode =
      result?.mode === 'saved_browsers'
        ? { mode: 'saved_browsers' as const }
        : result?.mode === 'active_sessions'
          ? { mode: 'active_sessions' as const }
          : {};
    if (
      (result?.mode === 'active_sessions' || result?.mode === 'saved_browsers') &&
      (!result.user_id || !Number.isFinite(Date.parse(result.server_time ?? '')))
    ) {
      return { state: 'unavailable', activeDeviceCount: null };
    }
    if (result?.allowed === false && result.reason === 'session_revoked') {
      recordBrowserSessionResult(result, requestStartedAt);
      return { state: 'session_revoked', activeDeviceCount: null };
    }
    const activeDeviceCount = result?.active_device_count;
    if (
      typeof result?.allowed !== 'boolean' ||
      typeof activeDeviceCount !== 'number' ||
      !Number.isInteger(activeDeviceCount) ||
      activeDeviceCount < 0 ||
      activeDeviceCount > 2
    ) {
      return { state: 'unavailable', activeDeviceCount: null };
    }
    if (
      result.mode === 'active_sessions' &&
      result.allowed &&
      (!result.user_id ||
        !Number.isFinite(Date.parse(result.lease_expires_at ?? '')) ||
        !Number.isFinite(Date.parse(result.server_time ?? '')) ||
        Date.parse(result.lease_expires_at!) <= Date.parse(result.server_time!))
    )
      return { state: 'unavailable', activeDeviceCount: null };
    recordBrowserSessionResult(result, requestStartedAt);
    return result.allowed
      ? { state: 'allowed', activeDeviceCount, ...mode }
      : { state: 'limit_reached', activeDeviceCount, ...mode };
  } catch (error) {
    if (__DEV__ && !isConnectivityError(error)) {
      console.warn('[Device access] Registration failed:', error);
    }
    return { state: 'unavailable', activeDeviceCount: null };
  }
}

/** Release this installation's slot during an intentional user sign-out. */
export async function releaseCurrentDevice(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const { data, error } = await supabase
      .rpc('revoke_current_device')
      .abortSignal(controller.signal);
    if (error || data !== true) throw new Error('Slot release was not confirmed');
  } catch (error) {
    if (__DEV__ && !isConnectivityError(error)) {
      console.warn('[Device access] Could not release device slot:', error);
    }
    throw new Error(
      'Could not release this browser slot. Check your connection and try signing out again.'
    );
  } finally {
    clearTimeout(timer);
  }
}
