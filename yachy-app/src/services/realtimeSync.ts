/**
 * Realtime Sync Service
 * Keeps app and web in sync when data changes on either platform.
 * Subscribes to Supabase Realtime for users and vessels.
 */

import { supabase } from './supabase';
import { User } from '../types';

type RealtimeSyncCallbacks = {
  onUserUpdated?: (user: User | null) => void;
  onVesselUpdated?: (vesselId: string) => void;
};

let channel: ReturnType<typeof supabase.channel> | null = null;
let callbacks: RealtimeSyncCallbacks = {};

function mapUserFromRow(data: any): User {
  return {
    id: data.id,
    email: data.email,
    name: data.name,
    position: data.position,
    department: data.department,
    department2: data.department_2 ?? null,
    role: data.role,
    vesselId: data.vessel_id,
    profilePhoto: data.profile_photo,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  } as User;
}

/**
 * Start Realtime subscriptions for the authenticated user.
 * Call when user logs in. Call stopRealtimeSync when they log out.
 */
export function startRealtimeSync(userId: string, vesselId: string | undefined, cbs: RealtimeSyncCallbacks) {
  stopRealtimeSync();
  callbacks = cbs;

  const ch = supabase
    .channel('app-sync')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'users',
        filter: `id=eq.${userId}`,
      },
      async (payload) => {
        if (payload.eventType === 'UPDATE' && payload.new) {
          const user = mapUserFromRow(payload.new);
          callbacks.onUserUpdated?.(user);
        } else if (payload.eventType === 'DELETE') {
          callbacks.onUserUpdated?.(null);
        }
      }
    );

  if (vesselId) {
    ch.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'vessels',
        filter: `id=eq.${vesselId}`,
      },
      () => {
        callbacks.onVesselUpdated?.(vesselId);
      }
    );
  }

  ch.subscribe();
  channel = ch;
}

/**
 * Stop Realtime subscriptions. Call on logout.
 */
export function stopRealtimeSync() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  callbacks = {};
}
