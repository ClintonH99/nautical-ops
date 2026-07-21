/**
 * Watch Duties
 * Rules, department-tagged duty groups with a personal checklist per
 * crew member (no automatic reset — manually ticked/unticked), and a
 * week-ahead watch assignment schedule. Editing is restricted to
 * Captain_MOV or HOD (checked as two distinct roles, never assumed to
 * be the same) - everyone can view and check items.
 */

import { supabase } from './supabase';

export type Department = 'BRIDGE' | 'ENGINEERING' | 'EXTERIOR' | 'INTERIOR' | 'GALLEY';

export interface DutyItem {
  id: string;
  label: string;
  sortOrder: number;
  checked: boolean;
}

export interface DutyGroup {
  id: string;
  title: string;
  department: Department;
  items: DutyItem[];
}

export interface WatchAssignment {
  id: string;
  date: string;
  userId: string;
  userName: string;
  startTime: string;
  endTime: string;
}

// ---- Rules ----

export async function getRules(vesselId: string): Promise<string> {
  const { data } = await supabase
    .from('watch_duty_rules')
    .select('content')
    .eq('vessel_id', vesselId)
    .maybeSingle();
  return data?.content ?? '';
}

export async function saveRules(vesselId: string, content: string): Promise<void> {
  const { error } = await supabase
    .from('watch_duty_rules')
    .upsert({ vessel_id: vesselId, content, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ---- Duty groups and items ----

export async function getDutyGroups(vesselId: string, userId: string): Promise<DutyGroup[]> {
  const { data: groups } = await supabase
    .from('watch_duty_groups')
    .select('id, title, department')
    .eq('vessel_id', vesselId)
    .order('created_at', { ascending: true });

  if (!groups || groups.length === 0) return [];

  const groupIds = groups.map((g) => g.id);
  const { data: items } = await supabase
    .from('watch_duty_items')
    .select('id, group_id, label, sort_order')
    .in('group_id', groupIds)
    .order('sort_order', { ascending: true });

  const itemIds = (items ?? []).map((i) => i.id);
  const { data: completions } = itemIds.length
    ? await supabase
        .from('watch_duty_completions')
        .select('item_id, checked')
        .eq('user_id', userId)
        .in('item_id', itemIds)
    : { data: [] as { item_id: string; checked: boolean }[] };

  const checkedMap = new Map((completions ?? []).map((c) => [c.item_id, c.checked]));

  return groups.map((g) => ({
    id: g.id,
    title: g.title,
    department: g.department as Department,
    items: (items ?? [])
      .filter((i) => i.group_id === g.id)
      .map((i) => ({
        id: i.id,
        label: i.label,
        sortOrder: i.sort_order,
        checked: checkedMap.get(i.id) ?? false,
      })),
  }));
}

export async function createDutyGroup(vesselId: string, title: string, department: Department): Promise<string> {
  const { data, error } = await supabase
    .from('watch_duty_groups')
    .insert({ vessel_id: vesselId, title, department })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function deleteDutyGroup(groupId: string): Promise<void> {
  const { error } = await supabase.from('watch_duty_groups').delete().eq('id', groupId);
  if (error) throw error;
}

export async function addDutyItem(groupId: string, label: string, sortOrder: number): Promise<void> {
  const { error } = await supabase.from('watch_duty_items').insert({ group_id: groupId, label, sort_order: sortOrder });
  if (error) throw error;
}

export async function deleteDutyItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('watch_duty_items').delete().eq('id', itemId);
  if (error) throw error;
}

export async function setItemChecked(userId: string, itemId: string, checked: boolean): Promise<void> {
  const { error } = await supabase
    .from('watch_duty_completions')
    .upsert({ user_id: userId, item_id: itemId, checked, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ---- Watch assignments (week-ahead schedule) ----

export async function getWeekAssignments(vesselId: string, startDate: string): Promise<WatchAssignment[]> {
  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const endStr = end.toISOString().slice(0, 10);

  const { data: rows } = await supabase
    .from('watch_assignments')
    .select('id, date, user_id, start_time, end_time')
    .eq('vessel_id', vesselId)
    .gte('date', startDate)
    .lte('date', endStr)
    .order('date', { ascending: true });

  if (!rows || rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: users } = await supabase.from('users').select('id, name').in('id', userIds);
  const nameMap = new Map((users ?? []).map((u) => [u.id, u.name]));

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    userId: r.user_id,
    userName: nameMap.get(r.user_id) ?? 'Unknown',
    startTime: r.start_time,
    endTime: r.end_time,
  }));
}

// Adds a watch assignment for a date. Normally one person covers a day,
// but the Captain/HOD can add a second (or more) for the same date if
// needed - this always creates a new row rather than replacing an
// existing one, so multiple people can be listed for the same day.
export async function addWatchAssignment(
  vesselId: string,
  date: string,
  userId: string,
  startTime: string,
  endTime: string
): Promise<void> {
  const { error } = await supabase
    .from('watch_assignments')
    .insert({ vessel_id: vesselId, date, user_id: userId, start_time: startTime, end_time: endTime });
  if (error) throw error;
}

export async function removeWatchAssignment(assignmentId: string): Promise<void> {
  const { error } = await supabase.from('watch_assignments').delete().eq('id', assignmentId);
  if (error) throw error;
}
