/**
 * Trips Service
 * Handles Guest Trips and Boss Trips for a vessel
 */

import { supabase } from './supabase';
import { Trip, TripType, Department } from '../types';

export interface CreateTripData {
  vesselId: string;
  type: TripType;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  notes?: string;
  department?: Department | null;
}

export interface UpdateTripData {
  title?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  department?: Department | null;
}

class TripsService {
  /**
   * Get all trips for a vessel (both Guest and Boss)
   */
  async getTripsByVessel(vesselId: string): Promise<Trip[]> {
    try {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('start_date', { ascending: true });

      if (error) throw error;
      return (data || []).map(this.mapRowToTrip);
    } catch (error) {
      console.error('Get trips error:', error);
      return [];
    }
  }

  /**
   * Get trips for a vessel by type (GUEST or BOSS)
   */
  async getTripsByVesselAndType(vesselId: string, type: TripType): Promise<Trip[]> {
    try {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .eq('vessel_id', vesselId)
        .eq('type', type)
        .order('start_date', { ascending: true });

      if (error) throw error;
      return (data || []).map(this.mapRowToTrip);
    } catch (error) {
      console.error('Get trips by type error:', error);
      return [];
    }
  }

  /**
   * Get trips in a date range (for calendar marked dates)
   */
  async getTripsInRange(vesselId: string, start: string, end: string): Promise<Trip[]> {
    try {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .eq('vessel_id', vesselId)
        .lte('start_date', end)
        .gte('end_date', start)
        .order('start_date', { ascending: true });

      if (error) throw error;
      return (data || []).map(this.mapRowToTrip);
    } catch (error) {
      console.error('Get trips in range error:', error);
      return [];
    }
  }

  /**
   * Create a new trip (HOD only in UI)
   */
  async createTrip(input: CreateTripData): Promise<Trip> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('trips')
        .insert([
          {
            vessel_id: input.vesselId,
            type: input.type,
            title: input.title.trim(),
            start_date: input.startDate,
            end_date: input.endDate,
            notes: input.notes?.trim() || null,
            department: input.department ?? null,
            created_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) throw error;
      return this.mapRowToTrip(data);
    } catch (error) {
      console.error('Create trip error:', error);
      throw error;
    }
  }

  /**
   * Update an existing trip
   */
  async updateTrip(tripId: string, input: UpdateTripData): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (input.title !== undefined) payload.title = input.title.trim();
      if (input.startDate !== undefined) payload.start_date = input.startDate;
      if (input.endDate !== undefined) payload.end_date = input.endDate;
      if (input.notes !== undefined) payload.notes = input.notes?.trim() || null;
      if (input.department !== undefined) payload.department = input.department ?? null;

      const { error } = await supabase
        .from('trips')
        .update(payload)
        .eq('id', tripId);

      if (error) throw error;
    } catch (error) {
      console.error('Update trip error:', error);
      throw error;
    }
  }

  /**
   * Delete a trip
   */
  async deleteTrip(tripId: string): Promise<void> {
    try {
      const { error } = await supabase.from('trips').delete().eq('id', tripId);
      if (error) throw error;
    } catch (error) {
      console.error('Delete trip error:', error);
      throw error;
    }
  }

  /**
   * Get a single trip by ID
   */
  async getTripById(tripId: string): Promise<Trip | null> {
    try {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .eq('id', tripId)
        .single();

      if (error) throw error;
      return data ? this.mapRowToTrip(data) : null;
    } catch (error) {
      console.error('Get trip error:', error);
      return null;
    }
  }

  private mapRowToTrip(row: any): Trip {
    return {
      id: row.id,
      vesselId: row.vessel_id,
      type: row.type,
      title: row.title,
      startDate: row.start_date,
      endDate: row.end_date,
      department: row.department ?? undefined,
      notes: row.notes ?? '',
      createdBy: row.created_by ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export default new TripsService();
