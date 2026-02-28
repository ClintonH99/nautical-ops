/**
 * General Waste Logs Service
 * CRUD for general waste log entries
 */

import { supabase } from './supabase';
import { GeneralWasteLog, WeightUnit } from '../types';

export interface CreateGeneralWasteLogData {
  vesselId: string;
  logDate: string;
  logTime: string;
  positionLocation: string;
  descriptionOfGarbage: string;
  weight?: number | null;
  weightUnit?: WeightUnit | null;
  createdByName: string;
}

export interface UpdateGeneralWasteLogData {
  logDate?: string;
  logTime?: string;
  positionLocation?: string;
  descriptionOfGarbage?: string;
  weight?: number | null;
  weightUnit?: WeightUnit | null;
}

class GeneralWasteLogsService {
  private mapRow(row: any): GeneralWasteLog {
    return {
      id: row.id,
      vesselId: row.vessel_id,
      logDate: row.log_date,
      logTime: row.log_time,
      positionLocation: row.position_location ?? '',
      descriptionOfGarbage: row.description_of_garbage ?? '',
      weight: row.weight != null ? Number(row.weight) : null,
      weightUnit: row.weight_unit ?? null,
      createdByName: row.created_by_name ?? '',
      createdAt: row.created_at,
    };
  }

  async getByVessel(vesselId: string): Promise<GeneralWasteLog[]> {
    try {
      const { data, error } = await supabase
        .from('general_waste_logs')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('log_date', { ascending: false });

      if (error) throw error;
      return (data || []).map(this.mapRow);
    } catch (error) {
      console.error('Get general waste logs error:', error);
      return [];
    }
  }

  async getById(id: string): Promise<GeneralWasteLog | null> {
    try {
      const { data, error } = await supabase
        .from('general_waste_logs')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data ? this.mapRow(data) : null;
    } catch (error) {
      console.error('Get general waste log error:', error);
      return null;
    }
  }

  async create(input: CreateGeneralWasteLogData): Promise<GeneralWasteLog> {
    const { data, error } = await supabase
      .from('general_waste_logs')
      .insert([
        {
          vessel_id: input.vesselId,
          log_date: input.logDate,
          log_time: input.logTime,
          position_location: input.positionLocation.trim() || null,
          description_of_garbage: input.descriptionOfGarbage.trim() || null,
          weight: input.weight ?? null,
          weight_unit: input.weightUnit ?? 'kgs',
          created_by_name: input.createdByName,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(data);
  }

  async update(id: string, input: UpdateGeneralWasteLogData): Promise<void> {
    const patch: Record<string, any> = {};
    if (input.logDate !== undefined) patch.log_date = input.logDate;
    if (input.logTime !== undefined) patch.log_time = input.logTime;
    if (input.positionLocation !== undefined) patch.position_location = input.positionLocation.trim() || null;
    if (input.descriptionOfGarbage !== undefined) patch.description_of_garbage = input.descriptionOfGarbage.trim() || null;
    if (input.weight !== undefined) patch.weight = input.weight;
    if (input.weightUnit !== undefined) patch.weight_unit = input.weightUnit;

    const { error } = await supabase
      .from('general_waste_logs')
      .update(patch)
      .eq('id', id);

    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('general_waste_logs')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}

export default new GeneralWasteLogsService();
