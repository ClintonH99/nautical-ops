/**
 * Watch Keeping Timetables Service
 * Publish and fetch watch keeping timetables for crew to view
 */

import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';

export interface TimetableSlot {
  crewId: string;
  crewName: string;
  crewPosition?: string;
  startTimeStr: string;
  endTimeStr: string;
  durationHours: number;
  /** Calendar dates in the vessel's local time. Present on all newly generated schedules. */
  startDate?: string;
  endDate?: string;
}

export interface WatchWorkPeriod {
  timetableId: string;
  watchTitle: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface PublishedWatchTimetable {
  id: string;
  vesselId: string;
  watchTitle: string;
  startTime: string;
  startLocation?: string;
  destination?: string;
  notes?: string;
  forDate: string | null;
  slots: TimetableSlot[];
  createdBy?: string;
  createdAt: string;
}

export interface PublishTimetableData {
  vesselId: string;
  watchTitle: string;
  startTime: string;
  startLocation?: string;
  destination?: string;
  notes?: string;
  forDate: string;
  slots: TimetableSlot[];
  createdBy?: string;
}

const MINUTES_PER_DAY = 24 * 60;

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function dateToDayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function dayNumberToDate(dayNumber: number): string {
  return new Date(dayNumber * 86_400_000).toISOString().slice(0, 10);
}

function minutesToTime(minutes: number): string {
  if (minutes === MINUTES_PER_DAY) return '24:00';
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** Convert an offset from a voyage start into an exact vessel-local date and time. */
export function getWatchDateTime(
  startDate: string,
  startTime: string,
  hoursFromStart: number
): { date: string; time: string } {
  const absoluteMinutes =
    dateToDayNumber(startDate) * MINUTES_PER_DAY +
    timeToMinutes(startTime) +
    Math.round(hoursFromStart * 60);
  const dayNumber = Math.floor(absoluteMinutes / MINUTES_PER_DAY);
  const minutesOfDay = absoluteMinutes - dayNumber * MINUTES_PER_DAY;
  return { date: dayNumberToDate(dayNumber), time: minutesToTime(minutesOfDay) };
}

function normalizeSlotDates(
  timetable: PublishedWatchTimetable
): Array<TimetableSlot & { startDate: string; endDate: string }> {
  if (!timetable.forDate) return [];

  let inferredStartDay = dateToDayNumber(timetable.forDate);
  let previousStartMinutes: number | null = null;

  return timetable.slots.map((slot) => {
    if (slot.startDate && slot.endDate) {
      previousStartMinutes = timeToMinutes(slot.startTimeStr);
      inferredStartDay = dateToDayNumber(slot.startDate);
      return { ...slot, startDate: slot.startDate, endDate: slot.endDate };
    }

    const startMinutes = timeToMinutes(slot.startTimeStr);
    if (previousStartMinutes !== null && startMinutes < previousStartMinutes) inferredStartDay += 1;
    const endMinutes = timeToMinutes(slot.endTimeStr);
    const inferredEndDay = inferredStartDay + (endMinutes <= startMinutes ? 1 : 0);
    previousStartMinutes = startMinutes;

    return {
      ...slot,
      startDate: dayNumberToDate(inferredStartDay),
      endDate: dayNumberToDate(inferredEndDay),
    };
  });
}

/**
 * Split date-aware watch slots at midnight so each Hours of Rest day receives
 * only the portion of the watch that occurred on that calendar date.
 */
export function getWatchPeriodsFromTimetables(
  timetables: PublishedWatchTimetable[],
  userId: string,
  startDate: string,
  endDate: string
): WatchWorkPeriod[] {
  const rangeStart = dateToDayNumber(startDate);
  const rangeEnd = dateToDayNumber(endDate);
  const periods: WatchWorkPeriod[] = [];

  for (const timetable of timetables) {
    for (const slot of normalizeSlotDates(timetable)) {
      if (slot.crewId !== userId) continue;

      const slotStartDay = dateToDayNumber(slot.startDate);
      const slotEndDay = dateToDayNumber(slot.endDate);
      const slotStartAbsolute = slotStartDay * MINUTES_PER_DAY + timeToMinutes(slot.startTimeStr);
      let slotEndAbsolute = slotEndDay * MINUTES_PER_DAY + timeToMinutes(slot.endTimeStr);
      if (slotEndAbsolute <= slotStartAbsolute) slotEndAbsolute += MINUTES_PER_DAY;

      for (
        let day = Math.max(slotStartDay, rangeStart);
        day <= Math.min(slotEndDay, rangeEnd);
        day++
      ) {
        const dayStart = day * MINUTES_PER_DAY;
        const dayEnd = dayStart + MINUTES_PER_DAY;
        const overlapStart = Math.max(slotStartAbsolute, dayStart);
        const overlapEnd = Math.min(slotEndAbsolute, dayEnd);
        if (overlapEnd <= overlapStart) continue;

        periods.push({
          timetableId: timetable.id,
          watchTitle: timetable.watchTitle,
          date: dayNumberToDate(day),
          startTime: minutesToTime(overlapStart - dayStart),
          endTime: minutesToTime(overlapEnd - dayStart),
        });
      }
    }
  }

  return periods.sort(
    (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
  );
}

/** Find rest periods that contradict an automatically imported watch. */
export function getRestWatchConflicts(
  restPeriods: Array<{ start: string; end: string }>,
  watchPeriods: WatchWorkPeriod[]
): WatchWorkPeriod[] {
  return watchPeriods.filter((watch) => {
    const watchStart = timeToMinutes(watch.startTime);
    const watchEnd = timeToMinutes(watch.endTime);

    return restPeriods.some((rest) => {
      const restStart = timeToMinutes(rest.start);
      let restEnd = timeToMinutes(rest.end);
      if (restEnd <= restStart) restEnd += MINUTES_PER_DAY;
      return Math.max(restStart, watchStart) < Math.min(restEnd, watchEnd);
    });
  });
}

function affectedCrewDates(timetables: PublishedWatchTimetable[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const timetable of timetables) {
    for (const slot of normalizeSlotDates(timetable)) {
      const periods = getWatchPeriodsFromTimetables(
        [{ ...timetable, slots: [slot] }],
        slot.crewId,
        slot.startDate,
        slot.endDate
      );
      if (!result.has(slot.crewId)) result.set(slot.crewId, new Set());
      periods.forEach((period) => result.get(slot.crewId)!.add(period.date));
    }
  }
  return result;
}

export interface WatchKeepingRules {
  id: string;
  vesselId: string;
  content: string;
  updatedAt: string;
  updatedBy?: string;
}

class WatchKeepingService {
  private async requireReconfirmation(timetables: PublishedWatchTimetable[]): Promise<void> {
    if (timetables.length === 0) return;
    const affected = affectedCrewDates(timetables);
    const vesselId = timetables[0].vesselId;

    for (const [userId, dates] of affected) {
      if (dates.size === 0) continue;
      const { error } = await supabase
        .from('rest_entries')
        .update({
          status: 'needs_reconfirmation',
          confirmed_by: null,
          confirmed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('vessel_id', vesselId)
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .in('date', [...dates]);
      if (error) throw error;
    }
  }

  async getRules(vesselId: string): Promise<WatchKeepingRules | null> {
    try {
      const { data, error } = await supabase
        .from('watch_keeping_rules')
        .select('*')
        .eq('vessel_id', vesselId)
        .maybeSingle();

      if (error) throw error;
      return data ? this.mapRulesRow(data) : null;
    } catch (e) {
      console.error('Get watch rules error:', e);
      return null;
    }
  }

  async upsertRules(
    vesselId: string,
    content: string,
    updatedBy?: string
  ): Promise<WatchKeepingRules> {
    const { data, error } = await supabase
      .from('watch_keeping_rules')
      .upsert(
        {
          vessel_id: vesselId,
          content: content.trim(),
          updated_at: new Date().toISOString(),
          updated_by: updatedBy || null,
        },
        { onConflict: 'vessel_id' }
      )
      .select()
      .single();

    if (error) throw error;
    return this.mapRulesRow(data);
  }

  private mapRulesRow(row: Record<string, unknown>): WatchKeepingRules {
    return {
      id: row.id as string,
      vesselId: row.vessel_id as string,
      content: (row.content as string) ?? '',
      updatedAt: row.updated_at as string,
      updatedBy: row.updated_by as string | undefined,
    };
  }

  async getByVessel(vesselId: string): Promise<PublishedWatchTimetable[]> {
    try {
      const { data, error } = await supabase
        .from('watch_keeping_timetables')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(this.mapRow);
    } catch (e) {
      console.error('Get watch timetables error:', e);
      throw e;
    }
  }

  async getByVesselAndDateRange(
    vesselId: string,
    startDate: string,
    endDate: string
  ): Promise<PublishedWatchTimetable[]> {
    try {
      const { data, error } = await supabase
        .from('watch_keeping_timetables')
        .select('*')
        .eq('vessel_id', vesselId)
        .gte('for_date', startDate)
        .lte('for_date', endDate)
        .order('for_date', { ascending: true });

      if (error) throw error;
      return (data || []).map(this.mapRow);
    } catch (e) {
      console.error('Get watch timetables by date range error:', e);
      return [];
    }
  }

  async publish(input: PublishTimetableData): Promise<PublishedWatchTimetable> {
    const { data, error } = await supabase
      .from('watch_keeping_timetables')
      .insert([
        {
          vessel_id: input.vesselId,
          watch_title: input.watchTitle.trim(),
          start_time: input.startTime,
          start_location: input.startLocation?.trim() || null,
          destination: input.destination?.trim() || null,
          notes: input.notes?.trim() || null,
          for_date: input.forDate,
          slots: input.slots,
          created_by: input.createdBy || null,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    const published = this.mapRow(data);
    await this.requireReconfirmation([published]);
    return published;
  }

  async update(id: string, input: PublishTimetableData): Promise<PublishedWatchTimetable> {
    const previous = await this.getById(id);
    const { data, error } = await supabase
      .from('watch_keeping_timetables')
      .update({
        watch_title: input.watchTitle.trim(),
        start_time: input.startTime,
        start_location: input.startLocation?.trim() || null,
        destination: input.destination?.trim() || null,
        notes: input.notes?.trim() || null,
        for_date: input.forDate,
        slots: input.slots,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    const updated = this.mapRow(data);
    await this.requireReconfirmation(previous ? [previous, updated] : [updated]);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const previous = await this.getById(id);
    if (previous) await this.requireReconfirmation([previous]);
    const { data, error } = await supabase
      .from('watch_keeping_timetables')
      .delete()
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Deleting the watch timetable');
  }

  async getById(id: string): Promise<PublishedWatchTimetable | null> {
    try {
      const { data, error } = await supabase
        .from('watch_keeping_timetables')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data ? this.mapRow(data) : null;
    } catch (e) {
      console.error('Get watch timetable by id error:', e);
      return null;
    }
  }

  async getWorkPeriodsForUser(
    vesselId: string,
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<WatchWorkPeriod[]> {
    const timetables = await this.getByVessel(vesselId);
    return getWatchPeriodsFromTimetables(timetables, userId, startDate, endDate);
  }

  private mapRow(row: Record<string, unknown>): PublishedWatchTimetable {
    return {
      id: row.id as string,
      vesselId: row.vessel_id as string,
      watchTitle: row.watch_title as string,
      startTime: row.start_time as string,
      startLocation: (row.start_location as string) ?? undefined,
      destination: (row.destination as string) ?? undefined,
      notes: (row.notes as string) ?? undefined,
      forDate: row.for_date as string,
      slots: (row.slots as TimetableSlot[]) ?? [],
      createdBy: row.created_by as string | undefined,
      createdAt: row.created_at as string,
    };
  }
}

export default new WatchKeepingService();
