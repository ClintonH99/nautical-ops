/**
 * Watch Keeping Timetables Service
 * Publish and fetch watch keeping timetables for crew to view
 */

import { supabase } from './supabase';

export interface TimetableSlot {
  crewId: string;
  crewName: string;
  crewPosition?: string;
  startTimeStr: string;
  endTimeStr: string;
  durationHours: number;
}

export interface PublishedWatchTimetable {
  id: string;
  vesselId: string;
  watchTitle: string;
  startTime: string;
  startLocation?: string;
  destination?: string;
  notes?: string;
  forDate: string;
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

export interface WatchKeepingRules {
  id: string;
  vesselId: string;
  content: string;
  updatedAt: string;
  updatedBy?: string;
}

class WatchKeepingService {
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

  async upsertRules(vesselId: string, content: string, updatedBy?: string): Promise<WatchKeepingRules> {
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
        .order('for_date', { ascending: false });

      if (error) throw error;
      return (data || []).map(this.mapRow);
    } catch (e) {
      console.error('Get watch timetables error:', e);
      return [];
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
    return this.mapRow(data);
  }

  async update(id: string, input: PublishTimetableData): Promise<PublishedWatchTimetable> {
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
    return this.mapRow(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('watch_keeping_timetables')
      .delete()
      .eq('id', id);

    if (error) throw error;
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
