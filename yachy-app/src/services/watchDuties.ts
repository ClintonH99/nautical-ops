import { offlineDuties } from '../offline/watchDutiesService';
import type { RecordValue } from '../offline/outbox';
import type { User } from '../types';
import userService from './user';
/**
 * Watch Duties
 * Rules, department-tagged duty groups with a personal checklist per
 * crew member (no automatic reset — manually ticked/unticked), and a
 * week-ahead watch assignment schedule. Editing is restricted to
 * Captain_MOV or HOD (checked as two distinct roles, never assumed to
 * be the same) - everyone can view and check items.
 */

import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';

export type Department = 'BRIDGE' | 'ENGINEERING' | 'EXTERIOR' | 'INTERIOR' | 'GALLEY';

export interface DutyItem {
  id: string;
  label: string;
  sortOrder: number;
  checked: boolean;
}

export interface DutyGroup {
  offlineLocalVersion?: number;
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

export const watchDutiesOfflineEnabled = offlineDuties.enabled;
export const subscribeWatchDuties = offlineDuties.subscribe;
export type DutyCrewMember = Pick<User, 'id' | 'name'>;
export async function getDutyCrew(vesselId: string): Promise<DutyCrewMember[]> {
  if (!offlineDuties.enabled()) return userService.getVesselCrew(vesselId);
  return (await offlineDuties.roster(vesselId)).map((u) => ({
    id: String(u.id),
    name: String(u.name),
  }));
}
function mapGroup(g: RecordValue, checks: RecordValue[] = []): DutyGroup {
  return {
    id: String(g.id),
    title: String(g.title),
    department: g.department as Department,
    offlineLocalVersion: Number(g.offlineLocalVersion),
    items: (g.items as RecordValue[]).map((i) => ({
      id: String(i.id),
      label: String(i.label),
      sortOrder: Number(i.sort_order),
      checked: checks.find((c) => c.item_id === i.id)?.checked === true,
    })),
  };
}
export async function getRulesEditor(
  vesselId: string
): Promise<{ content: string; version: number }> {
  if (!offlineDuties.enabled()) return { content: await getRules(vesselId), version: 0 };
  const r = (await offlineDuties.list('watchDutyRules', vesselId))[0];
  return { content: String(r?.content ?? ''), version: Number(r?.offlineLocalVersion ?? 0) };
}
export async function createDutyGroupWithItems(
  vesselId: string,
  title: string,
  department: Department,
  labels: string[]
): Promise<DutyGroup> {
  if (offlineDuties.enabled())
    return mapGroup(
      await offlineDuties.create('watchDuties', {
        vessel_id: vesselId,
        title,
        department,
        items: labels.map((label) => ({ label })),
      })
    );
  const id = await createDutyGroup(vesselId, title, department);
  try {
    return { id, title, department, items: await addDutyItems(id, labels) };
  } catch (e) {
    await deleteDutyGroup(id);
    throw e;
  }
}

// ---- Rules ----

export async function getRules(vesselId: string): Promise<string> {
  if (offlineDuties.enabled()) return (await getRulesEditor(vesselId)).content;
  const { data } = await supabase
    .from('watch_duty_rules')
    .select('content')
    .eq('vessel_id', vesselId)
    .maybeSingle();
  return data?.content ?? '';
}

export async function saveRules(
  vesselId: string,
  content: string,
  version?: number
): Promise<void> {
  if (offlineDuties.enabled()) {
    if (version === 0)
      await offlineDuties.create('watchDutyRules', { vessel_id: vesselId, content });
    else await offlineDuties.update('watchDutyRules', vesselId, { content }, version);
    return;
  }
  const { error } = await supabase
    .from('watch_duty_rules')
    .upsert({ vessel_id: vesselId, content, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ---- Duty groups and items ----

export async function getDutyGroups(vesselId: string, userId: string): Promise<DutyGroup[]> {
  if (offlineDuties.enabled()) {
    const [groups, checks] = await Promise.all([
      offlineDuties.list('watchDuties', vesselId),
      offlineDuties.list('watchDutyChecks', vesselId),
    ]);
    if (checks.some((c) => c.user_id !== userId)) throw new Error('Account changed');
    return groups.map((g) => mapGroup(g, checks));
  }
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

export async function createDutyGroup(
  vesselId: string,
  title: string,
  department: Department
): Promise<string> {
  if (offlineDuties.enabled())
    return (await createDutyGroupWithItems(vesselId, title, department, [])).id;
  const { data, error } = await supabase
    .from('watch_duty_groups')
    .insert({ vessel_id: vesselId, title, department })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function deleteDutyGroup(groupId: string): Promise<void> {
  if (offlineDuties.enabled()) await offlineDuties.beforeDelete();
  const { data, error } = await supabase
    .from('watch_duty_groups')
    .delete()
    .eq('id', groupId)
    .select('id');
  requireAffectedRows(data, error, 'Deleting the watch-duty group');
}

export async function addDutyItem(
  groupId: string,
  label: string,
  sortOrder: number,
  version?: number,
  vesselId?: string
): Promise<string> {
  if (offlineDuties.enabled()) {
    if (!vesselId) throw new Error('Vessel required');
    const g = (await offlineDuties.list('watchDuties', vesselId)).find((g) => g.id === groupId);
    if (!g) throw new Error('Duty group not downloaded');
    const items = g.items as RecordValue[],
      id = crypto.randomUUID();
    await offlineDuties.update(
      'watchDuties',
      groupId,
      {
        items: [
          ...items,
          {
            id,
            group_id: groupId,
            label,
            sort_order: Math.max(-1, ...items.map((i) => Number(i.sort_order))) + 1,
            created_at: new Date().toISOString(),
          },
        ],
      },
      version
    );
    return id;
  }
  const { data, error } = await supabase
    .from('watch_duty_items')
    .insert({ group_id: groupId, label, sort_order: sortOrder })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function addDutyItems(groupId: string, labels: string[]): Promise<DutyItem[]> {
  if (offlineDuties.enabled()) throw new Error('Save the duty group and its items together.');
  if (labels.length === 0) return [];

  const rows = labels.map((label, sortOrder) => ({
    group_id: groupId,
    label,
    sort_order: sortOrder,
  }));
  const { data, error } = await supabase
    .from('watch_duty_items')
    .insert(rows)
    .select('id, label, sort_order');
  if (error) throw error;

  return (data ?? [])
    .map((item) => ({
      id: item.id,
      label: item.label,
      sortOrder: item.sort_order,
      checked: false,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function deleteDutyItem(itemId: string): Promise<void> {
  if (offlineDuties.enabled()) await offlineDuties.beforeDelete();
  const { data, error } = await supabase
    .from('watch_duty_items')
    .delete()
    .eq('id', itemId)
    .select('id');
  requireAffectedRows(data, error, 'Deleting the watch-duty item');
}

export async function setItemChecked(
  userId: string,
  itemId: string,
  checked: boolean,
  expected?: boolean
): Promise<void> {
  if (offlineDuties.enabled()) return offlineDuties.check(userId, itemId, checked, expected);
  const { error } = await supabase
    .from('watch_duty_completions')
    .upsert({ user_id: userId, item_id: itemId, checked, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/**
 * Untick every duty item for every crew member on a vessel. Completion rows
 * are removed rather than changed to false because a missing row already
 * represents the unchecked state.
 */
export async function resetDutyCompletionsForVessel(vesselId: string): Promise<void> {
  if (offlineDuties.enabled()) await offlineDuties.beforeDelete();
  const { data: groups, error: groupsError } = await supabase
    .from('watch_duty_groups')
    .select('id')
    .eq('vessel_id', vesselId);
  if (groupsError) throw groupsError;

  const groupIds = (groups ?? []).map((group) => group.id);
  if (groupIds.length === 0) return;

  const { data: items, error: itemsError } = await supabase
    .from('watch_duty_items')
    .select('id')
    .in('group_id', groupIds);
  if (itemsError) throw itemsError;

  const itemIds = (items ?? []).map((item) => item.id);
  if (itemIds.length === 0) return;

  const { error } = await supabase.from('watch_duty_completions').delete().in('item_id', itemIds);
  if (error) throw error;
}

// ---- Watch assignments (week-ahead schedule) ----

export async function getWeekAssignments(
  vesselId: string,
  startDate: string
): Promise<WatchAssignment[]> {
  if (offlineDuties.enabled()) {
    const end = new Date(startDate + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 6);
    const [rows, crew] = await Promise.all([
      offlineDuties.list('watchAssignments', vesselId),
      getDutyCrew(vesselId),
    ]);
    return rows
      .filter(
        (r) => String(r.date) >= startDate && String(r.date) <= end.toISOString().slice(0, 10)
      )
      .map((r) => ({
        id: String(r.id),
        date: String(r.date),
        userId: String(r.user_id),
        userName: crew.find((c) => c.id === r.user_id)?.name ?? 'Crew Member',
        startTime: String(r.start_time),
        endTime: String(r.end_time),
      }));
  }
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
): Promise<string> {
  if (offlineDuties.enabled())
    return String(
      (
        await offlineDuties.create('watchAssignments', {
          vessel_id: vesselId,
          date,
          user_id: userId,
          start_time: startTime,
          end_time: endTime,
        })
      ).id
    );
  const { data, error } = await supabase
    .from('watch_assignments')
    .insert({
      vessel_id: vesselId,
      date,
      user_id: userId,
      start_time: startTime,
      end_time: endTime,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function removeWatchAssignment(assignmentId: string): Promise<void> {
  if (offlineDuties.enabled()) await offlineDuties.beforeDelete();
  const { data, error } = await supabase
    .from('watch_assignments')
    .delete()
    .eq('id', assignmentId)
    .select('id');
  requireAffectedRows(data, error, 'Removing the watch assignment');
}

/** Clear every crew assignment in the displayed Monday-Sunday week. */
export async function resetWeekAssignments(vesselId: string, startDate: string): Promise<void> {
  if (offlineDuties.enabled()) await offlineDuties.beforeDelete();
  const end = new Date(`${startDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const endDate = end.toISOString().slice(0, 10);

  const { error } = await supabase
    .from('watch_assignments')
    .delete()
    .eq('vessel_id', vesselId)
    .gte('date', startDate)
    .lte('date', endDate);
  if (error) throw error;
}
