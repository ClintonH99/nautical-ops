import { offlineVesselRecords } from '../offline/vesselRecordService';
import { createdInLogMonth } from '../utils/vesselLogHistory';
const offline = offlineVesselRecords('generalWasteLogs');
/**
 * General Waste Logs Service
 * CRUD for general waste log entries
 */

import { supabase } from './supabase';
import { getVesselLogMonthRows } from './vesselLogMonthQuery';
import { requireAffectedRows } from './mutationResult';
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
  subscribe = offline.subscribe;
  async getByVesselMonth(vesselId: string, month: string): Promise<GeneralWasteLog[]> {
    if (offline.enabled())
      return (await offline.list(vesselId))
        .filter((row) => createdInLogMonth(String(row.created_at), month))
        .map(this.mapRow);
    return (await getVesselLogMonthRows('general_waste_logs', vesselId, month)).map(this.mapRow);
  }

  private mapRow(row: any): GeneralWasteLog {
    return {
      offlineLocalVersion: row.offlineLocalVersion,
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
    if (offline.enabled())
      return (await offline.list(vesselId))
        .map(this.mapRow)
        .sort((a, b) => b.logDate.localeCompare(a.logDate));
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
      throw error;
    }
  }

  async getById(id: string): Promise<GeneralWasteLog | null> {
    if (offline.enabled()) {
      const row = await offline.read(id);
      return row ? this.mapRow(row) : null;
    }
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
    if (offline.enabled())
      return this.mapRow(
        await offline.create({
          vessel_id: input.vesselId,
          log_date: input.logDate,
          log_time: input.logTime,
          position_location: input.positionLocation.trim() || null,
          description_of_garbage: input.descriptionOfGarbage.trim() || null,
          weight: input.weight ?? null,
          weight_unit: input.weightUnit ?? 'kgs',
          created_by_name: input.createdByName?.trim() || null,
        })
      );
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
          created_by_name: input.createdByName?.trim() || null,
        },
      ])
      .select();

    if (error) throw error;
    const row = data?.[0];
    if (!row) throw new Error('Could not save waste entry. Check your connection and try again.');
    return this.mapRow(row);
  }

  async update(id: string, input: UpdateGeneralWasteLogData, version?: number): Promise<void> {
    const patch: Record<string, any> = {};
    if (input.logDate !== undefined) patch.log_date = input.logDate;
    if (input.logTime !== undefined) patch.log_time = input.logTime;
    if (input.positionLocation !== undefined)
      patch.position_location = input.positionLocation.trim() || null;
    if (input.descriptionOfGarbage !== undefined)
      patch.description_of_garbage = input.descriptionOfGarbage.trim() || null;
    if (input.weight !== undefined) patch.weight = input.weight;
    if (input.weightUnit !== undefined) patch.weight_unit = input.weightUnit;

    if (offline.enabled()) {
      await offline.update(id, patch, version);
      return;
    }
    const { data, error } = await supabase
      .from('general_waste_logs')
      .update(patch)
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Updating the waste log');
  }

  async delete(id: string): Promise<void> {
    if (offline.enabled()) await offline.beforeDelete(id);
    const { data, error } = await supabase
      .from('general_waste_logs')
      .delete()
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Deleting the waste log');
    if (offline.enabled()) await offline.refresh();
  }
}

export default new GeneralWasteLogsService();
