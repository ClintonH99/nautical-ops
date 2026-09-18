/**
 * Fuel Logs Service
 * CRUD for vessel fuel log entries
 */

import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';
import { FuelLog, FuelVolumeUnit } from '../types';

export interface CreateFuelLogData {
  vesselId: string;
  locationOfRefueling: string;
  logDate: string;
  logTime: string;
  amountOfFuel: number;
  pricePerGallon: number;
  totalPrice: number;
  createdByName: string;
  /** Omit only for legacy callers; new fuel flows should always supply a unit. */
  volumeUnit?: FuelVolumeUnit | null;
  /** ISO-style currency code. Defaults to USD for backwards compatibility. */
  currencyCode?: string;
  comment?: string;
}

export interface UpdateFuelLogData {
  locationOfRefueling?: string;
  logDate?: string;
  logTime?: string;
  amountOfFuel?: number;
  pricePerGallon?: number;
  totalPrice?: number;
  volumeUnit?: FuelVolumeUnit | null;
  currencyCode?: string;
  comment?: string;
}

function normalizeCurrencyCode(value: string | undefined): string {
  const code = (value ?? 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error('Currency code must be a three-letter ISO-style code.');
  }
  return code;
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
      pricePerVolumeUnit: parseFloat(row.price_per_gallon) || 0,
      totalPrice: parseFloat(row.total_price) || 0,
      volumeUnit: row.volume_unit ?? null,
      currencyCode: row.currency_code ?? 'USD',
      comment: row.comment ?? '',
      createdBy: row.created_by ?? null,
      createdByName: row.created_by_name ?? '',
      createdAt: row.created_at,
      effectiveAt: row.effective_at ?? null,
      utcOffsetMinutes: row.utc_offset_minutes == null ? null : Number(row.utc_offset_minutes),
      inventoryRevision:
        row.inventory_revision == null ? undefined : Number(row.inventory_revision),
      currentInventoryOperationId: row.current_inventory_operation_id ?? null,
      voidedAt: row.voided_at ?? null,
    };
  }

  async getByVessel(vesselId: string): Promise<FuelLog[]> {
    const { data, error } = await supabase
      .from('fuel_logs')
      .select('*')
      .eq('vessel_id', vesselId)
      .is('voided_at', null)
      .order('log_date', { ascending: false });

    if (error) throw error;
    return (data || []).map(this.mapRow);
  }

  async getById(id: string): Promise<FuelLog | null> {
    const { data, error } = await supabase
      .from('fuel_logs')
      .select('*')
      .eq('id', id)
      .is('voided_at', null)
      .maybeSingle();

    if (error) throw error;
    return data ? this.mapRow(data) : null;
  }

  /**
   * @deprecated Current clients must use fuelManagementService so writes are
   * allocated, revisioned, and audited. This direct method exists only for
   * rollout compatibility before a vessel activates the inventory ledger.
   */
  async create(input: CreateFuelLogData): Promise<FuelLog> {
    const currencyCode = normalizeCurrencyCode(input.currencyCode);
    const { data, error } = await supabase
      .from('fuel_logs')
      .insert([
        {
          vessel_id: input.vesselId,
          location_of_refueling: input.locationOfRefueling.trim() || null,
          log_date: input.logDate,
          log_time: input.logTime,
          amount_of_fuel: input.amountOfFuel,
          price_per_gallon: input.pricePerGallon,
          total_price: input.totalPrice,
          created_by_name: input.createdByName,
          volume_unit: input.volumeUnit ?? null,
          currency_code: currencyCode,
          comment: input.comment?.trim() || '',
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(data);
  }

  /**
   * @deprecated Current clients must use fuelManagementService so writes are
   * revisioned and audited. This direct method exists only for rollout
   * compatibility before a vessel activates the inventory ledger.
   */
  async update(id: string, input: UpdateFuelLogData): Promise<void> {
    const patch: Record<string, any> = {};
    if (input.locationOfRefueling !== undefined)
      patch.location_of_refueling = input.locationOfRefueling.trim() || null;
    if (input.logDate !== undefined) patch.log_date = input.logDate;
    if (input.logTime !== undefined) patch.log_time = input.logTime;
    if (input.amountOfFuel !== undefined) patch.amount_of_fuel = input.amountOfFuel;
    if (input.pricePerGallon !== undefined) patch.price_per_gallon = input.pricePerGallon;
    if (input.totalPrice !== undefined) patch.total_price = input.totalPrice;
    if (input.volumeUnit !== undefined) patch.volume_unit = input.volumeUnit;
    if (input.currencyCode !== undefined)
      patch.currency_code = normalizeCurrencyCode(input.currencyCode);
    if (input.comment !== undefined) patch.comment = input.comment.trim();

    const { data, error } = await supabase
      .from('fuel_logs')
      .update(patch)
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Updating the fuel log');
  }

  /**
   * @deprecated Current clients must void fuel records through
   * fuelManagementService. Direct deletion is retained temporarily for
   * already-released clients before inventory activation.
   */
  async delete(id: string): Promise<void> {
    const { data, error } = await supabase.from('fuel_logs').delete().eq('id', id).select('id');
    requireAffectedRows(data, error, 'Deleting the fuel log');
  }
}

export default new FuelLogsService();
