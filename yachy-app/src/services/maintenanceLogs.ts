/**
 * Maintenance Logs Service
 * CRUD for maintenance log entries (persist until manually deleted)
 */

import { supabase } from './supabase';
import { MaintenanceLog } from '../types';

export interface CreateMaintenanceLogData {
  vesselId: string;
  equipment: string;
  portStarboardNa?: string;
  serialNumber?: string;
  hoursOfService?: string;
  hoursAtNextService?: string;
  whatServiceDone?: string;
  notes?: string;
  serviceDoneBy: string;
}

export interface UpdateMaintenanceLogData {
  equipment?: string;
  portStarboardNa?: string;
  serialNumber?: string;
  hoursOfService?: string;
  hoursAtNextService?: string;
  whatServiceDone?: string;
  notes?: string;
  serviceDoneBy?: string;
}

class MaintenanceLogsService {
  async getByVessel(vesselId: string): Promise<MaintenanceLog[]> {
    try {
      const { data, error } = await supabase
        .from('maintenance_logs')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(this.mapRowToLog);
    } catch (error) {
      console.error('Get maintenance logs error:', error);
      return [];
    }
  }

  async create(input: CreateMaintenanceLogData): Promise<MaintenanceLog> {
    try {
      const { data, error } = await supabase
        .from('maintenance_logs')
        .insert([
          {
            vessel_id: input.vesselId,
            equipment: input.equipment.trim(),
            port_starboard_na: input.portStarboardNa?.trim() || null,
            serial_number: input.serialNumber?.trim() || null,
            hours_of_service: input.hoursOfService?.trim() || null,
            hours_at_next_service: input.hoursAtNextService?.trim() || null,
            what_service_done: input.whatServiceDone?.trim() || null,
            notes: input.notes?.trim() || null,
            service_done_by: input.serviceDoneBy.trim(),
            updated_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) throw error;
      return this.mapRowToLog(data);
    } catch (error) {
      console.error('Create maintenance log error:', error);
      throw error;
    }
  }

  async update(logId: string, input: UpdateMaintenanceLogData): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (input.equipment !== undefined) payload.equipment = input.equipment.trim();
      if (input.portStarboardNa !== undefined) payload.port_starboard_na = input.portStarboardNa?.trim() || null;
      if (input.serialNumber !== undefined) payload.serial_number = input.serialNumber?.trim() || null;
      if (input.hoursOfService !== undefined) payload.hours_of_service = input.hoursOfService?.trim() || null;
      if (input.hoursAtNextService !== undefined) payload.hours_at_next_service = input.hoursAtNextService?.trim() || null;
      if (input.whatServiceDone !== undefined) payload.what_service_done = input.whatServiceDone?.trim() || null;
      if (input.notes !== undefined) payload.notes = input.notes?.trim() || null;
      if (input.serviceDoneBy !== undefined) payload.service_done_by = input.serviceDoneBy.trim();

      const { error } = await supabase
        .from('maintenance_logs')
        .update(payload)
        .eq('id', logId);

      if (error) throw error;
    } catch (error) {
      console.error('Update maintenance log error:', error);
      throw error;
    }
  }

  async delete(logId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('maintenance_logs')
        .delete()
        .eq('id', logId);

      if (error) throw error;
    } catch (error) {
      console.error('Delete maintenance log error:', error);
      throw error;
    }
  }

  async getById(logId: string): Promise<MaintenanceLog | null> {
    try {
      const { data, error } = await supabase
        .from('maintenance_logs')
        .select('*')
        .eq('id', logId)
        .single();

      if (error) throw error;
      return data ? this.mapRowToLog(data) : null;
    } catch (error) {
      console.error('Get maintenance log error:', error);
      return null;
    }
  }

  private mapRowToLog(row: Record<string, unknown>): MaintenanceLog {
    return {
      id: row.id as string,
      vesselId: row.vessel_id as string,
      equipment: (row.equipment as string) ?? '',
      portStarboardNa: (row.port_starboard_na as string) ?? '',
      serialNumber: (row.serial_number as string) ?? '',
      hoursOfService: (row.hours_of_service as string) ?? '',
      hoursAtNextService: (row.hours_at_next_service as string) ?? '',
      whatServiceDone: (row.what_service_done as string) ?? '',
      notes: (row.notes as string) ?? '',
      serviceDoneBy: (row.service_done_by as string) ?? '',
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}

export default new MaintenanceLogsService();
