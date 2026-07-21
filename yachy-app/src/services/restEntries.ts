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

// Same-day check used while a crew member is actively filling in a single
// day (before it's placed on the full timeline). Checks the basic shape of
// that day's periods: count and the 6h-continuous rule. The true 10h/24h
// and 77h/7day rolling checks require the surrounding days too — see
// checkRollingCompliance below, which is what actually determines STCW
// compliance for a date once neighboring days are known.
export function checkCompliance(periods: RestPeriod[]): ComplianceResult {
  const violations: string[] = [];
  const totalMinutes = periods.reduce((sum, p) => {
    const start = timeToMinutes(p.start);
    const end = timeToMinutes(p.end);
    const duration = end > start ? end - start : 24 * 60 - start + end;
    return sum + duration;
  }, 0);
  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;

  if (totalMinutes < 10 * 60) {
    violations.push(`Only ${totalHours}h rest today, below the 10h minimum`);
  }
  if (periods.length > 2) {
    violations.push(`${periods.length} rest periods, maximum is 2`);
  }
  if (periods.length > 0 && longestPeriodMinutes(periods) < 6 * 60) {
    violations.push('No rest period of at least 6 continuous hours');
  }

  return { compliant: violations.length === 0, totalRestHours: totalHours, violations };
}

interface TimelineInterval {
  startMin: number; // minutes from the reference date (entries[0]'s date, 00:00)
  endMin: number;
}

// Builds a continuous timeline of rest intervals in absolute minutes from a
// reference date, from a set of daily entries. A period recorded on date D
// that crosses midnight (end <= start) is anchored to start on D and end on
// D+1 — this is the convention the day editor already uses, and prevents
// double-counting since each day's periods are recorded once, on the date
// they begin.
function buildTimeline(
  entries: { date: string; rest_periods: RestPeriod[] }[],
  referenceDate: Date
): TimelineInterval[] {
  const intervals: TimelineInterval[] = [];
  for (const entry of entries) {
    const entryDate = new Date(entry.date + 'T00:00:00');
    const dayOffsetMin = Math.round((entryDate.getTime() - referenceDate.getTime()) / 60000);
    for (const p of entry.rest_periods || []) {
      const startMin = dayOffsetMin + timeToMinutes(p.start);
      let endMin = dayOffsetMin + timeToMinutes(p.end);
      if (endMin <= startMin) endMin += 24 * 60;
      intervals.push({ startMin, endMin });
    }
  }
  intervals.sort((a, b) => a.startMin - b.startMin);
  return intervals;
}

function restInWindow(intervals: TimelineInterval[], windowStart: number, windowEnd: number): number {
  let total = 0;
  for (const iv of intervals) {
    const overlapStart = Math.max(iv.startMin, windowStart);
    const overlapEnd = Math.min(iv.endMin, windowEnd);
    if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
  }
  return total;
}

// Exactly finds the minimum rest total across every possible window of
// windowSizeMinutes whose start falls within [rangeStart, rangeEnd]. Rather
// than brute-force checking every minute, this uses the fact that the total
// only changes at interval boundaries — so the true minimum is guaranteed
// to occur at one of a small number of candidate points, which is both
// exact and fast.
function minRestInAnyWindow(
  intervals: TimelineInterval[],
  rangeStart: number,
  rangeEnd: number,
  windowSizeMinutes: number
): number {
  const candidates = new Set<number>([rangeStart, rangeEnd]);
  for (const iv of intervals) {
    for (const point of [iv.startMin, iv.endMin, iv.startMin - windowSizeMinutes, iv.endMin - windowSizeMinutes]) {
      if (point >= rangeStart && point <= rangeEnd) candidates.add(point);
    }
  }
  let min = Infinity;
  candidates.forEach((t) => {
    const rest = restInWindow(intervals, t, t + windowSizeMinutes);
    if (rest < min) min = rest;
  });
  return min === Infinity ? 0 : min;
}

export interface RollingComplianceResult {
  minRestIn24h: number; // hours, worst-case in any 24h window starting this day
  minRestIn7Days: number; // hours, worst-case in any 7-day window starting this day
  maxGapBetweenRestHours: number; // largest gap between the end of one rest period and the start of the next, touching this day
  compliant: boolean;
  violations: string[];
}

// The real STCW/MLC check: given a specific date and the full set of
// entries surrounding it (ideally covering at least 7 days before and 1
// day after), computes the worst-case rest in any 24-hour and any 7-day
// window that starts during that date, plus the longest gap between
// consecutive rest periods. This is what should be shown as the
// authoritative compliance figure for a date, not the same-day-only check.
export function checkRollingCompliance(
  targetDate: string,
  allEntries: { date: string; rest_periods: RestPeriod[] }[]
): RollingComplianceResult {
  const sorted = [...allEntries].sort((a, b) => a.date.localeCompare(b.date));
  const referenceDate = new Date(sorted[0].date + 'T00:00:00');
  const intervals = buildTimeline(sorted, referenceDate);

  const target = new Date(targetDate + 'T00:00:00');
  const dayStartMin = Math.round((target.getTime() - referenceDate.getTime()) / 60000);
  const dayEndMin = dayStartMin + 24 * 60;

  // Windows are checked BACKWARD from this date (ending during it), not
  // forward — compliance can only be judged on rest that has actually
  // happened, not on future days that haven't been entered yet.
  const minRest24hMin = minRestInAnyWindow(intervals, dayStartMin - 24 * 60, dayEndMin - 24 * 60, 24 * 60);
  const minRest7dMin = minRestInAnyWindow(intervals, dayStartMin - 7 * 24 * 60, dayEndMin - 7 * 24 * 60, 7 * 24 * 60);

  // A brand-new record won't have 7 days of history yet — that's expected,
  // not a violation, so the 7-day check is skipped until there's enough
  // history to actually evaluate it.
  const daysOfHistory = Math.round((target.getTime() - referenceDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  const has7DaysHistory = daysOfHistory >= 7;

  let maxGapMin = 0;
  for (let i = 0; i < intervals.length - 1; i++) {
    const gap = intervals[i + 1].startMin - intervals[i].endMin;
    // Only count gaps touching this date's 24h window
    if (intervals[i].endMin >= dayStartMin - 24 * 60 && intervals[i + 1].startMin <= dayEndMin) {
      maxGapMin = Math.max(maxGapMin, gap);
    }
  }

  const minRestIn24h = Math.round((minRest24hMin / 60) * 10) / 10;
  const minRestIn7Days = Math.round((minRest7dMin / 60) * 10) / 10;
  const maxGapBetweenRestHours = Math.round((maxGapMin / 60) * 10) / 10;

  const violations: string[] = [];
  if (minRest24hMin < 10 * 60) {
    violations.push(`As low as ${minRestIn24h}h rest in a 24h window, below the 10h minimum`);
  }
  if (has7DaysHistory && minRest7dMin < 77 * 60) {
    violations.push(`As low as ${minRestIn7Days}h rest in a 7-day window, below the 77h minimum`);
  }
  if (maxGapMin > 14 * 60) {
    violations.push(`${maxGapBetweenRestHours}h gap between rest periods, exceeds the 14h maximum`);
  }

  return {
    minRestIn24h,
    minRestIn7Days,
    maxGapBetweenRestHours,
    compliant: violations.length === 0,
    violations,
  };
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
  department: Department;
  status: 'missing' | 'draft' | 'pending_confirmation' | 'confirmed';
  compliant?: boolean;
  violations?: string[];
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
    .select('id, name, department')
    .eq('vessel_id', vesselId);

  // Fetch with 7 days of padding before the month starts, so the rolling
  // 7-day compliance check has enough context for the first days shown.
  const paddedStart = new Date(startDate);
  paddedStart.setDate(paddedStart.getDate() - 7);
  const startStr = toDateStr(paddedStart);
  const endStr = toDateStr(effectiveEnd);

  const { data: entries } = await supabase
    .from('rest_entries')
    .select('id, user_id, date, status, rest_periods')
    .eq('vessel_id', vesselId)
    .gte('date', startStr)
    .lte('date', endStr);

  const entriesByUser = new Map<string, { date: string; rest_periods: RestPeriod[] }[]>();
  (entries ?? []).forEach((e) => {
    if (!entriesByUser.has(e.user_id)) entriesByUser.set(e.user_id, []);
    entriesByUser.get(e.user_id)!.push({ date: e.date, rest_periods: e.rest_periods || [] });
  });

  const statusMap = new Map<string, string>();
  (entries ?? []).forEach((e) => statusMap.set(`${e.date}|${e.user_id}`, e.status));

  const monthStartStr = toDateStr(startDate);
  const days: DayReview[] = [];
  for (let d = new Date(startDate); d <= effectiveEnd; d.setDate(d.getDate() + 1)) {
    const dateStr = toDateStr(d);
    const dayEntries: DayReviewEntry[] = (crew ?? []).map((c) => {
      const status = (statusMap.get(`${dateStr}|${c.id}`) as DayReviewEntry['status']) ?? 'missing';
      let compliant: boolean | undefined;
      let violations: string[] | undefined;
      if (status !== 'missing') {
        const history = entriesByUser.get(c.id) ?? [];
        if (history.length > 0) {
          const rolling = checkRollingCompliance(dateStr, history);
          compliant = rolling.compliant;
          violations = rolling.violations;
        }
      }
      return { userId: c.id, userName: c.name, department: c.department as Department, status, compliant, violations };
    });
    // Only count dates within the actual requested month for needsAttention/
    // display — the padding days before it exist purely for rolling context.
    if (dateStr >= monthStartStr) {
      const needsAttention = dayEntries.some((e) => e.status !== 'confirmed' || e.compliant === false);
      days.push({ date: dateStr, entries: dayEntries, needsAttention });
    }
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


// Determines whether the logged-in user has manager-level access to edit
// or confirm a specific crew member's rest entries: either they are the
// vessel's Captain (always has access), or they are the assigned signer
// for that crew member's department.
export async function canManageRestFor(
  viewerUserId: string,
  viewerRole: string,
  targetUserId: string,
  vesselId: string
): Promise<boolean> {
  if (viewerRole === 'CAPTAIN_MOV') return true;

  const { data: target } = await supabase
    .from('users')
    .select('department')
    .eq('id', targetUserId)
    .single();

  if (!target?.department) return false;

  const { data: signer } = await supabase
    .from('department_signers')
    .select('signer_user_id')
    .eq('vessel_id', vesselId)
    .eq('department', target.department)
    .maybeSingle();

  return signer?.signer_user_id === viewerUserId;
}


// Returns which departments a user can review rest entries for: the
// Captain can review every department ('ALL'), while a department signer
// can only review the department(s) they've been assigned to (possibly
// more than one, since the same person can be assigned across several
// departments).
export async function getManagedDepartments(
  userId: string,
  role: string,
  vesselId: string
): Promise<Department[] | 'ALL'> {
  if (role === 'CAPTAIN_MOV') return 'ALL';

  const { data } = await supabase
    .from('department_signers')
    .select('department')
    .eq('vessel_id', vesselId)
    .eq('signer_user_id', userId);

  return (data ?? []).map((d) => d.department as Department);
}


export interface PdfDayRow {
  date: string;
  hourMarks: boolean[]; // 24 booleans, true = working hour
  restHoursToday: string; // "HH:MM"
  restIn24h: string;
  restIn7d: string;
}

export interface PdfMonthData {
  seafarerName: string;
  rank: string;
  vesselName: string;
  vesselImoNumber: string;
  monthLabel: string;
  isWatchKeeper: boolean;
  days: PdfDayRow[];
}

function minutesToHHMM(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Builds 24 hourly work/rest marks for one day from work_start/work_end,
// excluding the lunch period (lunch is neither work nor rest on the form,
// left blank same as rest).
function buildHourMarks(workStart: string | null, workEnd: string | null, lunchStart: string | null, lunchEnd: string | null): boolean[] {
  const marks = new Array(24).fill(false);
  if (!workStart || !workEnd) return marks;

  const ws = timeToMinutes(workStart);
  let we = timeToMinutes(workEnd);
  if (we <= ws) we += 24 * 60;

  let ls: number | null = null;
  let le: number | null = null;
  if (lunchStart && lunchEnd) {
    ls = timeToMinutes(lunchStart);
    le = timeToMinutes(lunchEnd);
    if (le <= ls) le += 24 * 60;
  }

  for (let h = 0; h < 24; h++) {
    const hourStart = h * 60;
    const inWork = hourStart >= ws && hourStart < we;
    const inLunch = ls !== null && le !== null && hourStart >= ls && hourStart < le;
    marks[h] = inWork && !inLunch;
  }
  return marks;
}

// Assembles everything needed to render one crew member's month on the
// Hours of Work and Rest PDF: header info, per-day hour marks, and the
// real rolling 24h/7d compliance figures for each date.
export async function getMonthDataForPdf(userId: string, year: number, month: number): Promise<PdfMonthData | null> {
  const { data: user } = await supabase
    .from('users')
    .select('name, position, vessel_id, vessel_joined_at')
    .eq('id', userId)
    .single();

  if (!user || !user.vessel_id) return null;

  const { data: vessel } = await supabase
    .from('vessels')
    .select('name, imo_number')
    .eq('id', user.vessel_id)
    .single();

  const monthStart = new Date(year, month - 1, 1);
  const joinedDate = user.vessel_joined_at ? new Date(user.vessel_joined_at) : monthStart;
  const effectiveStart = joinedDate > monthStart ? joinedDate : monthStart;
  const lastDayOfMonth = new Date(year, month, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const effectiveEnd = lastDayOfMonth < today ? lastDayOfMonth : today;

  const { data: watchKeeperRow } = await supabase
    .from('watch_keepers')
    .select('user_id')
    .eq('vessel_id', user.vessel_id)
    .eq('user_id', userId)
    .maybeSingle();
  const isWatchKeeper = !!watchKeeperRow;

  if (effectiveStart > effectiveEnd) {
    return {
      seafarerName: user.name,
      rank: user.position ?? '',
      vesselName: vessel?.name ?? '',
      vesselImoNumber: vessel?.imo_number ?? '',
      monthLabel: monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      isWatchKeeper,
      days: [],
    };
  }

  // Fetch with 7 days of padding before the range so rolling 7-day checks
  // have context for the first days shown.
  const paddedStart = new Date(effectiveStart);
  paddedStart.setDate(paddedStart.getDate() - 7);

  const { data: entries } = await supabase
    .from('rest_entries')
    .select('date, rest_periods, work_start, work_end, lunch_start, lunch_end')
    .eq('user_id', userId)
    .gte('date', toDateStr(paddedStart))
    .lte('date', toDateStr(effectiveEnd));

  const entryMap = new Map((entries ?? []).map((e) => [e.date, e]));
  const historyForRolling = (entries ?? []).map((e) => ({ date: e.date, rest_periods: e.rest_periods || [] }));

  const days: PdfDayRow[] = [];
  for (let d = new Date(effectiveStart); d <= effectiveEnd; d.setDate(d.getDate() + 1)) {
    const dateStr = toDateStr(d);
    const entry = entryMap.get(dateStr);

    const restPeriods = entry?.rest_periods ?? [];
    const restMinutesToday = restPeriods.reduce((sum: number, p: RestPeriod) => {
      const start = timeToMinutes(p.start);
      const end = timeToMinutes(p.end);
      return sum + (end > start ? end - start : 24 * 60 - start + end);
    }, 0);

    const rolling = checkRollingCompliance(dateStr, historyForRolling);

    days.push({
      date: dateStr,
      hourMarks: buildHourMarks(entry?.work_start ?? null, entry?.work_end ?? null, entry?.lunch_start ?? null, entry?.lunch_end ?? null),
      restHoursToday: minutesToHHMM(restMinutesToday),
      restIn24h: minutesToHHMM(rolling.minRestIn24h * 60),
      restIn7d: minutesToHHMM(rolling.minRestIn7Days * 60),
    });
  }

  return {
    seafarerName: user.name,
    rank: user.position ?? '',
    vesselName: vessel?.name ?? '',
    vesselImoNumber: vessel?.imo_number ?? '',
    monthLabel: monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    isWatchKeeper,
    days,
  };
}
