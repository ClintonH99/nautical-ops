import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import { getCurrentDeviceFingerprint, getDeviceLabel } from './deviceAccess';

export type SavedDevice = {
  id: string;
  device_name: string | null;
  platform: string;
  last_seen_at: string;
  is_current: boolean;
};

export async function listAccountDevices(): Promise<SavedDevice[]> {
  const { data, error } = await supabase.rpc('list_account_devices');
  if (error) throw error;
  return data ?? [];
}

export async function removeAccountDevice(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('remove_account_device', { p_device_id: id });
  if (error) throw error;
  if (data !== true) throw new Error('Could not confirm device removal. Refresh and try again.');
}

/** Ephemeral recovery authentication never signs the main application in early. */
export function createDeviceRecovery() {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'nautical-device-recovery' },
  });
  let challenge: string | null = null;
  let email = '';
  let userId = '';
  let verified = false;
  let completed = false;
  let adopted = false;
  return {
    async start(inputEmail: string, password: string) {
      email = inputEmail.trim().toLowerCase();
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.user) throw new Error('Could not verify your account. Check your email and password.');
      userId = data.user.id;
      const result = await client.rpc('begin_device_recovery');
      if (result.error) throw result.error;
      if (typeof result.data !== 'string') throw new Error('Could not start device recovery. Try again.');
      challenge = result.data;
      const sent = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (sent.error) throw new Error('Could not send the verification code. Please wait a moment and try again.');
    },
    async resend() {
      if (!challenge) throw new Error('Start recovery again.');
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (error) throw new Error('Could not resend the code. Please wait before trying again.');
    },
    async verify(code: string): Promise<SavedDevice[]> {
      if (!challenge) throw new Error('Start recovery again.');
      const { data, error } = await client.auth.verifyOtp({ email, token: code.trim(), type: 'email' });
      if (error || !data.session || data.user?.id !== userId) throw new Error('That code is invalid or expired. Request a new code and try again.');
      verified = true;
      const result = await client.rpc('list_account_devices', { p_challenge: challenge });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    async refresh(): Promise<SavedDevice[]> {
      if (!verified || !challenge) throw new Error('Verify your email first.');
      const { data, error } = await client.rpc('list_account_devices', { p_challenge: challenge });
      if (error) throw error;
      return data ?? [];
    },
    async replace(ids: string[]) {
      if (!verified || !challenge) throw new Error('Verify your email first.');
      const { data, error } = await client.rpc('complete_device_recovery', {
        p_challenge: challenge, p_remove_device_ids: ids,
        p_device_fingerprint: await getCurrentDeviceFingerprint(),
        p_platform: Platform.OS, p_device_name: getDeviceLabel(),
      });
      if (error) throw error;
      if (data?.allowed !== true) throw new Error('Could not register this device. Refresh and try again.');
      completed = true;
    },
    async continueToApp() {
      if (!completed) throw new Error('Replace a saved device before continuing.');
      const { data } = await client.auth.getSession();
      if (!data.session) throw new Error('Your session expired. Please sign in again.');
      adopted = true;
      try {
        const { error } = await supabase.auth.setSession({
          access_token: data.session.access_token, refresh_token: data.session.refresh_token,
        });
        if (error) throw error;
      } catch (error) {
        adopted = false;
        throw error;
      }
    },
    async dispose() {
      if (adopted) return;
      // Cancel only the ephemeral login, never other devices or the app session.
      if (completed) await client.rpc('revoke_current_device');
      await client.auth.signOut({ scope: 'local' });
    },
  };
}
