/**
 * Hours of Rest service
 * Handles fetching, saving, and submitting weekly rest/work/lunch entries,
 * plus the STCW-based compliance check (10hr/24hr minimum, max 2 rest
 * periods, one period >= 6 continuous hours).
 */

import { supabase } from './supabase';

export interface RestPeriod {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

export interface RestEntry {
  id?: string;
  user_id: string;
  vessel_id: string;
  date: string; // "YYYY-MM-DD"
  rest_periods: RestPeriod[];
  work_start: string | null;
  work_end: string | null;
  lunch_start: string | null;
  lunch_end: string | null;
  status: 'draft' | 'pending_confirmation' | 'confirmed';
  confirmed_by?: string | null;
  confirmed_at?: string | null;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Returns total rest minutes across all periods for one day, handling
// periods that cross midnight (e.g. 22:00 -> 08:00).
function totalRestMinutes(periods: RestPeriod[]): number {
  return periods.reduce((sum, p) => {
    const start = timeToMinutes(p.start);
    const end = timeToMinutes(p.end);
    const duration = end > start ? end - start : 24 * 60 - start + end;
    return sum + duration;
  }, 0);
}

function longestPeriodMinutes(periods: RestPeriod[]): number {
  return periods.reduce((max, p) => {
    const start = timeToMinutes(p.start);
    const end = timeToMinutes(p.end);
    const duration = end > start ? end - start : 24 * 60 - start + end;
    return Math.max(max, duration);
  }, 0);
}

export interface ComplianceResult {
  compliant: boolean;
  totalRestHours: number;
  violations: string[];
}

// Checks a single day's rest periods against STCW rules:
// - at least 10 hours total rest in 24 hours
// - no more than 2 rest periods
// - at least one period of 6+ continuous hours
export function checkCompliance(periods: RestPeriod[]): ComplianceResult {
  const violations: string[] = [];
  const totalMinutes = totalRestMinutes(periods);
  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;

  if (totalMinutes < 10 * 60) {
    violations.push(`Only ${totalHours}h rest, below the 10h minimum`);
  }
  if (periods.length > 2) {
    violations.push(`${periods.length} rest periods, maximum is 2`);
  }
  if (periods.length > 0 && longestPeriodMinutes(periods) < 6 * 60) {
    violations.push('No rest period of at least 6 continuous hours');
  }

  return { compliant: violations.length === 0, totalRestHours: totalHours, violations };
}

export async function getWeekEntries(userId: string, weekStartDate: string): Promise<RestEntry[]> {
  const start = new Date(weekStartDate);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const { data, error } = await supabase
    .from('rest_entries')
    .select('*')
    .eq('user_id', userId)
    .in('date', dates);

  if (error) throw error;
  return data ?? [];
}

export async function saveEntry(entry: RestEntry): Promise<RestEntry> {
  const { data, error } = await supabase
    .from('rest_entries')
    .upsert(entry, { onConflict: 'user_id,date' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function submitWeekForConfirmation(userId: string, dates: string[]): Promise<void> {
  console.log('DEBUG submit userId:', userId, 'dates:', dates);
  const { error, data } = await supabase
    .from('rest_entries')
    .update({ status: 'pending_confirmation' })
    .eq('user_id', userId)
    .in('date', dates)
    .select();

  console.log('DEBUG submit result — error:', JSON.stringify(error), 'data:', JSON.stringify(data));
  if (error) throw error;
}

export async function confirmEntry(entryId: string, confirmedByUserId: string): Promise<void> {
  const { error } = await supabase
    .from('rest_entries')
    .update({
      status: 'confirmed',
      confirmed_by: confirmedByUserId,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', entryId);

  if (error) throw error;
}

export const DEPARTMENTS = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'] as const;
export type Department = typeof DEPARTMENTS[number];

export interface DepartmentSigner {
  department: Department;
  signerUserId: string;
  signerName: string;
}

export async function getDepartmentSigners(vesselId: string): Promise<DepartmentSigner[]> {
  const { data: rows } = await supabase
    .from('department_signers')
    .select('department, signer_user_id')
    .eq('vessel_id', vesselId);

  if (!rows || rows.length === 0) return [];

  const userIds = rows.map((r) => r.signer_user_id);
  const { data: users } = await supabase
    .from('users')
    .select('id, name')
    .in('id', userIds);

  const nameMap = new Map((users ?? []).map((u) => [u.id, u.name]));

  return rows.map((r) => ({
    department: r.department as Department,
    signerUserId: r.signer_user_id,
    signerName: nameMap.get(r.signer_user_id) ?? 'Unknown',
  }));
}

export async function setDepartmentSigner(
  vesselId: string,
  department: Department,
  signerUserId: string
): Promise<void> {
  const { error } = await supabase
    .from('department_signers')
    .upsert(
      { vessel_id: vesselId, department, signer_user_id: signerUserId, updated_at: new Date().toISOString() },
      { onConflict: 'vessel_id,department' }
    );

  if (error) throw error;
}


export interface DayReviewEntry {
  userId: string;
  userName: string;
  status: 'missing' | 'draft' | 'pending_confirmation' | 'confirmed';
}

export interface DayReview {
  date: string;
  entries: DayReviewEntry[];
  needsAttention: boolean;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Builds a per-day review of every crew member's rest status for a given
// month, most recent day first. Days beyond today are excluded since
// nothing is due yet. Used by the Captain's "Rest to be Confirmed" queue.
export async function getMonthReview(vesselId: string, year: number, month: number): Promise<DayReview[]> {
  const startDate = new Date(year, month - 1, 1);
  const lastDayOfMonth = new Date(year, month, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const effectiveEnd = lastDayOfMonth < today ? lastDayOfMonth : today;

  const { data: crew } = await supabase
    .from('users')
    .select('id, name')
    .eq('vessel_id', vesselId);

  const startStr = toDateStr(startDate);
  const endStr = toDateStr(effectiveEnd);

  const { data: entries } = await supabase
    .from('rest_entries')
    .select('id, user_id, date, status')
    .eq('vessel_id', vesselId)
    .gte('date', startStr)
    .lte('date', endStr);

  const entryMap = new Map<string, { status: string }>();
  (entries ?? []).forEach((e) => entryMap.set(`${e.date}|${e.user_id}`, { status: e.status }));

  const days: DayReview[] = [];
  for (let d = new Date(startDate); d <= effectiveEnd; d.setDate(d.getDate() + 1)) {
    const dateStr = toDateStr(d);
    const dayEntries: DayReviewEntry[] = (crew ?? []).map((c) => {
      const e = entryMap.get(`${dateStr}|${c.id}`);
      return {
        userId: c.id,
        userName: c.name,
        status: (e?.status as DayReviewEntry['status']) ?? 'missing',
      };
    });
    const needsAttention = dayEntries.some((e) => e.status !== 'confirmed');
    days.push({ date: dateStr, entries: dayEntries, needsAttention });
  }

  return days.reverse();
}

export function getPastMonths(count: number): { year: number; month: number; label: string }[] {
  const result = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    });
  }
  return result;
}

export async function confirmEntryForUser(
  targetUserId: string,
  vesselId: string,
  date: string,
  restPeriods: RestPeriod[],
  workStart: string | null,
  workEnd: string | null,
  lunchStart: string | null,
  lunchEnd: string | null,
  confirmedByUserId: string
): Promise<void> {
  const entry: RestEntry = {
    user_id: targetUserId,
    vessel_id: vesselId,
    date,
    rest_periods: restPeriods,
    work_start: workStart,
    work_end: workEnd,
    lunch_start: lunchStart,
    lunch_end: lunchEnd,
    status: 'confirmed',
    confirmed_by: confirmedByUserId,
    confirmed_at: new Date().toISOString(),
  };
  await saveEntry(entry);
}
