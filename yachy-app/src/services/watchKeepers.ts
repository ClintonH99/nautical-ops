/**
 * Designated Watch Keepers
 * A simple, Captain-managed list of which crew members are designated
 * watch keepers. Feeds the "Watchkeeper: Yes/No" field on the Hours of
 * Rest PDF export.
 */

import { supabase } from './supabase';

export interface WatchKeeperEntry {
  userId: string;
  userName: string;
}

export async function getWatchKeepers(vesselId: string): Promise<WatchKeeperEntry[]> {
  const { data: rows } = await supabase
    .from('watch_keepers')
    .select('user_id')
    .eq('vessel_id', vesselId);

  if (!rows || rows.length === 0) return [];

  const userIds = rows.map((r) => r.user_id);
  const { data: users } = await supabase
    .from('users')
    .select('id, name')
    .in('id', userIds);

  return (users ?? []).map((u) => ({ userId: u.id, userName: u.name }));
}

export async function addWatchKeeper(vesselId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('watch_keepers').insert({ vessel_id: vesselId, user_id: userId });
  if (error) throw error;
}

export async function removeWatchKeeper(vesselId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('watch_keepers').delete().eq('vessel_id', vesselId).eq('user_id', userId);
  if (error) throw error;
}

export async function isWatchKeeper(vesselId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('watch_keepers')
    .select('user_id')
    .eq('vessel_id', vesselId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}
