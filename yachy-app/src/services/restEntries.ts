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
