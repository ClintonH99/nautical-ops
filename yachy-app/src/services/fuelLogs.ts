/**
 * Fuel Logs Service
 * CRUD for vessel fuel log entries
 */

import { supabase } from './supabase';
import { FuelLog } from '../types';

export interface CreateFuelLogData {
  vesselId: string;
  locationOfRefueling: string;
  logDate: string;
  logTime: string;
  amountOfFuel: number;
  pricePerGallon: number;
  totalPrice: number;
  createdByName: string;
}

export interface UpdateFuelLogData {
  locationOfRefueling?: string;
  logDate?: string;
  logTime?: string;
  amountOfFuel?: number;
  pricePerGallon?: number;
  totalPrice?: number;
}

class FuelLogsService {
  private mapRow(row: any): FuelLog {
    return {
      id: row.id,
      vesselId: row.vessel_id,
      locationOfRefueling: row.location_of_refueling ?? '',
      logDate: row.log_date,
      logTime: row.log_time,
      amountOfFuel: parseFloat(row.amount_of_fuel) || 0,
      pricePerGallon: parseFloat(row.price_per_gallon) || 0,
      totalPrice: parseFloat(row.total_price) || 0,
      createdByName: row.created_by_name ?? '',
      createdAt: row.created_at,
    };
  }

  async getByVessel(vesselId: string): Promise<FuelLog[]> {
    try {
      const { data, error } = await supabase
        .from('fuel_logs')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('log_date', { ascending: false });

      if (error) throw error;
      return (data || []).map(this.mapRow);
    } catch (error) {
      console.error('Get fuel logs error:', error);
      return [];
    }
  }

  async getById(id: string): Promise<FuelLog | null> {
    try {
      const { data, error } = await supabase
        .from('fuel_logs')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data ? this.mapRow(data) : null;
    } catch (error) {
      console.error('Get fuel log error:', error);
      return null;
    }
  }

  async create(input: CreateFuelLogData): Promise<FuelLog> {
    const { data, error } = await supabase
      .from('fuel_logs')
      .insert([{
        vessel_id: input.vesselId,
        location_of_refueling: input.locationOfRefueling.trim() || null,
        log_date: input.logDate,
        log_time: input.logTime,
        amount_of_fuel: input.amountOfFuel,
        price_per_gallon: input.pricePerGallon,
        total_price: input.totalPrice,
        created_by_name: input.createdByName,
      }])
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(data);
  }

  async update(id: string, input: UpdateFuelLogData): Promise<void> {
    const patch: Record<string, any> = {};
    if (input.locationOfRefueling !== undefined) patch.location_of_refueling = input.locationOfRefueling.trim() || null;
    if (input.logDate !== undefined) patch.log_date = input.logDate;
    if (input.logTime !== undefined) patch.log_time = input.logTime;
    if (input.amountOfFuel !== undefined) patch.amount_of_fuel = input.amountOfFuel;
    if (input.pricePerGallon !== undefined) patch.price_per_gallon = input.pricePerGallon;
    if (input.totalPrice !== undefined) patch.total_price = input.totalPrice;

    const { error } = await supabase
      .from('fuel_logs')
      .update(patch)
      .eq('id', id);

    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('fuel_logs')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}

export default new FuelLogsService();
