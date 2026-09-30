import { supabase } from './supabase';
import authService from './auth';
import { registerCurrentDevice, DEVICE_LIMIT_MESSAGE } from './deviceAccess';
import { useAuthStore } from '../store';
import type { LoginCredentials } from './auth';
import { getVesselSubscriptionAccess } from './subscription';

export const APPOINT_CAPTAIN_TITLE = 'Appoint Another Captain/MOV';
export const APPOINT_CAPTAIN_MESSAGE =
  'You are the only Captain/MOV on this vessel. Before you can leave, promote another crew member to Captain/MOV in Crew Management. The vessel must have at least one Captain/MOV remaining.';

export const isOnlyCaptainError = (message: string) =>
  message.toLowerCase().includes('only captain/mov');

/** Supabase puts non-2xx function response bodies on error.context, not data. */
export async function invokeVesselAction(name: 'leave-vessel' | 'delete-vessel') {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('Could not verify your session. Please sign in again.');
  const { data, error } = await supabase.functions.invoke(name, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error || data?.error) {
    let body = data;
    if (error && typeof error.context?.json === 'function') {
      const response = error.context.clone?.() ?? error.context;
      body = await response.json().catch(() => null);
    }
    throw new Error(
      typeof body?.error === 'string' && body.error.trim()
        ? body.error
        : 'Something went wrong. Please contact support@nautical-ops.com'
    );
  }
  return data;
}

/**
 * Recovery is authenticated, but deliberately does not require a paid vessel.
 * Keep auth/realtime routing deferred until the server has moved the member
 * AND we have loaded the new profile. Never fabricate a client-side departure.
 */
export async function leaveVesselForAccount(credentials?: LoginCredentials) {
  const store = useAuthStore.getState();
  if (store.deferUserUpdate) throw new Error('Another account action is in progress. Please wait.');
  store.setDeferUserUpdate(true);
  let completed = false;
  let departed = false;
  try {
    const user = credentials ? (await authService.signIn(credentials)).user : store.user;
    if (!user) throw new Error('Please sign in to the account you want to leave the vessel with.');
    const device = await registerCurrentDevice();
    if (device.state === 'limit_reached') throw new Error(DEVICE_LIMIT_MESSAGE);
    if (device.state !== 'allowed') {
      throw new Error('Could not verify this device. Please check your connection and try again.');
    }

    // Login recovery is for Crew/HOD, not an escape from a Captain's payment
    // screen. Check the authenticated role before any membership mutation.
    if (user.role === 'CAPTAIN_MOV') {
      const access = user.vesselId
        ? await getVesselSubscriptionAccess(user.vesselId)
        : { state: 'never_subscribed' };
      if (access.state === 'unavailable') {
        throw new Error('Could not check your vessel subscription. Please try signing in again.');
      }
      store.setLoginNotice(null);
      store.setCaptainPaymentRequired(access.state === 'payment_required');
      store.setUser(user);
      completed = true;
      return user;
    }
    if (user.role !== 'CREW' && user.role !== 'HOD') {
      throw new Error('Please sign in normally to manage your account.');
    }

    const result = await invokeVesselAction('leave-vessel');
    if (!result?.success || !result.vessel_id)
      throw new Error(
        'Could not confirm departure. Please sign in again to check your account before retrying.'
      );
    departed = true;
    const fresh = await authService.getUserProfile(user.id);
    if (!fresh || fresh.vesselId !== result.vessel_id || fresh.role !== 'CREW') {
      throw new Error(
        'You have left the vessel, but your account could not be refreshed. Please sign in again.'
      );
    }
    store.setLoginNotice(null);
    store.setCaptainPaymentRequired(false);
    store.setUser(fresh);
    completed = true;
    return fresh;
  } finally {
    // Failed login recovery must not leave a paid-vessel session behind. If
    // departure succeeded but refresh failed, also discard the old cached role.
    if (!completed && (credentials || departed)) {
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        /* best effort */
      }
      store.setUser(null);
      store.setCaptainPaymentRequired(false);
    }
    store.setDeferUserUpdate(false);
  }
}
