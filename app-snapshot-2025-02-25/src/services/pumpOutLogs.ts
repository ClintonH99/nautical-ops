/**
 * Pump Out Logs Service
 * CRUD for vessel pump out log entries
 */

import { supabase } from './supabase';
import { PumpOutLog, DischargeType } from '../types';

export interface CreatePumpOutLogData {
  vesselId: string;
  dischargeType: DischargeType;
  pumpoutServiceName: string;
  location: string;
  amountInGallons: number;
  description: string;
  logDate: string;
  logTime: string;
  createdByName: string;
}

export interface UpdatePumpOutLogData {
  dischargeType?: DischargeType;
  pumpoutServiceName?: string;
  location?: string;
  amountInGallons?: number;
  description?: string;
  logDate?: string;
  logTime?: string;
}

class PumpOutLogsService {
  private mapRow(row: any): PumpOutLog {
    return {
      id: row.id,
      vesselId: row.vessel_id,
      dischargeType: row.discharge_type as DischargeType,
      pumpoutServiceName: row.pumpout_service_name ?? '',
      location: row.location ?? '',
      amountInGallons: parseFloat(row.amount_in_gallons) || 0,
      description: row.description ?? '',
      logDate: row.log_date,
      logTime: row.log_time,
      createdByName: row.created_by_name ?? '',
      createdAt: row.created_at,
    };
  }

  async getByVessel(vesselId: string): Promise<PumpOutLog[]> {
    try {
      const { data, error } = await supabase
        .from('pump_out_logs')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('log_date', { ascending: false });

      if (error) throw error;
      return (data || []).map(this.mapRow);
    } catch (error) {
      console.error('Get pump out logs error:', error);
      return [];
    }
  }

  async getById(id: string): Promise<PumpOutLog | null> {
    try {
      const { data, error } = await supabase
        .from('pump_out_logs')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data ? this.mapRow(data) : null;
    } catch (error) {
      console.error('Get pump out log error:', error);
      return null;
    }
  }

  async create(input: CreatePumpOutLogData): Promise<PumpOutLog> {
    const { data, error } = await supabase
      .from('pump_out_logs')
      .insert([{
        vessel_id: input.vesselId,
        discharge_type: input.dischargeType,
        pumpout_service_name: input.pumpoutServiceName.trim() || null,
        location: input.location.trim() || null,
        amount_in_gallons: input.amountInGallons,
        description: input.description.trim() || null,
        log_date: input.logDate,
        log_time: input.logTime,
        created_by_name: input.createdByName,
      }])
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(data);
  }

  async update(id: string, input: UpdatePumpOutLogData): Promise<void> {
    const patch: Record<string, any> = {};
    if (input.dischargeType !== undefined) patch.discharge_type = input.dischargeType;
    if (input.pumpoutServiceName !== undefined) patch.pumpout_service_name = input.pumpoutServiceName.trim() || null;
    if (input.location !== undefined) patch.location = input.location.trim() || null;
    if (input.amountInGallons !== undefined) patch.amount_in_gallons = input.amountInGallons;
    if (input.description !== undefined) patch.description = input.description.trim() || null;
    if (input.logDate !== undefined) patch.log_date = input.logDate;
    if (input.logTime !== undefined) patch.log_time = input.logTime;

    const { error } = await supabase
      .from('pump_out_logs')
      .update(patch)
      .eq('id', id);

    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('pump_out_logs')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}

export default new PumpOutLogsService();
