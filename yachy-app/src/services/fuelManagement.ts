/**
 * Shared fuel-management data service.
 *
 * This layer is intentionally additive to fuelLogsService: legacy fuel log
 * callers remain valid, while tank-aware screens can use the transactional RPCs
 * below to keep a log and its allocations consistent.
 */

import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';
import type { CreateFuelLogData, UpdateFuelLogData } from './fuelLogs';
import type {
  FuelLog,
  FuelLogAllocationSnapshot,
  FuelLogTankAllocation,
  FuelLogTankEntry,
  FuelLogTankEntryInput,
  FuelSetup,
  FuelSetupTankInput,
  FuelTank,
  FuelTankBalance,
  FuelTankInput,
  FuelTransfer,
  FuelTransferInput,
  FuelVolumeUnit,
  VesselFuelSettings,
} from '../types';

export interface SaveFuelSetupInput {
  vesselId: string;
  volumeUnit: FuelVolumeUnit;
  tanks: FuelSetupTankInput[];
}

export interface CreateFuelLogWithTankEntriesInput {
  log: CreateFuelLogData;
  entries: FuelLogTankEntryInput[];
}

export interface UpdateFuelLogWithTankEntriesInput {
  vesselId: string;
  log: UpdateFuelLogData;
  entries: FuelLogTankEntryInput[];
}

type DatabaseRow = Record<string, unknown>;

interface FuelSetupRpcResult {
  settings: DatabaseRow | null;
  tanks: DatabaseRow[];
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCurrencyCode(value: string | undefined): string {
  const code = (value ?? 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error('Currency code must be a three-letter ISO-style code.');
  }
  return code;
}

function assertTankInput(input: FuelTankInput): void {
  if (!input.name.trim()) throw new Error('Fuel tank name is required.');
  if (!Number.isFinite(input.capacityLitres) || input.capacityLitres <= 0) {
    throw new Error('Fuel tank capacity must be greater than zero litres.');
  }
}

function assertEntries(entries: FuelLogTankEntryInput[]): void {
  if (!entries.length) throw new Error('At least one tank allocation is required.');
  const tankIds = new Set<string>();
  for (const entry of entries) {
    if (!entry.fuelTankId) throw new Error('Each allocation must select a fuel tank.');
    if (!Number.isFinite(entry.amountLitres) || entry.amountLitres <= 0) {
      throw new Error('Each allocation amount must be greater than zero litres.');
    }
    if (tankIds.has(entry.fuelTankId)) {
      throw new Error('A tank can only appear once in a fuel log.');
    }
    tankIds.add(entry.fuelTankId);
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mapFuelLog(row: DatabaseRow): FuelLog {
  const pricePerVolumeUnit = asNumber(row.price_per_gallon);
  return {
    id: asString(row.id),
    vesselId: asString(row.vessel_id),
    locationOfRefueling: asString(row.location_of_refueling),
    logDate: asString(row.log_date),
    logTime: asString(row.log_time),
    amountOfFuel: asNumber(row.amount_of_fuel),
    pricePerGallon: pricePerVolumeUnit,
    pricePerVolumeUnit,
    totalPrice: asNumber(row.total_price),
    volumeUnit: (row.volume_unit as FuelVolumeUnit | null | undefined) ?? null,
    currencyCode: asString(row.currency_code) || 'USD',
    comment: asString(row.comment),
    createdBy: asString(row.created_by) || null,
    createdByName: asString(row.created_by_name),
    createdAt: asString(row.created_at),
  };
}

function mapSettings(row: DatabaseRow): VesselFuelSettings {
  return {
    vesselId: asString(row.vessel_id),
    volumeUnit: row.volume_unit as FuelVolumeUnit,
    createdBy: asString(row.created_by) || null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function mapTank(row: DatabaseRow): FuelTank {
  return {
    id: asString(row.id),
    vesselId: asString(row.vessel_id),
    name: asString(row.name),
    location: asString(row.location),
    description: asString(row.description),
    capacityLitres: asNumber(row.capacity_litres),
    createdBy: asString(row.created_by) || null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function mapLogTankEntry(row: DatabaseRow): FuelLogTankEntry {
  return {
    id: asString(row.id),
    vesselId: asString(row.vessel_id),
    fuelLogId: asString(row.fuel_log_id),
    fuelTankId: asString(row.fuel_tank_id),
    amountLitres: asNumber(row.amount_litres),
    createdAt: asString(row.created_at),
  };
}

function relatedTankName(value: unknown): string {
  const related = Array.isArray(value) ? value[0] : value;
  if (!related || typeof related !== 'object') return '';
  return asString((related as DatabaseRow).name);
}

function mapLogTankAllocation(row: DatabaseRow): FuelLogTankAllocation {
  return {
    fuelLogId: asString(row.fuel_log_id),
    fuelTankId: asString(row.fuel_tank_id),
    tankName: relatedTankName(row.fuel_tank) || 'Unknown tank',
    amountLitres: asNumber(row.amount_litres),
  };
}

function mapTransfer(row: DatabaseRow): FuelTransfer {
  return {
    id: asString(row.id),
    vesselId: asString(row.vessel_id),
    sourceTankId: asString(row.source_tank_id),
    destinationTankId: asString(row.destination_tank_id),
    amountLitres: asNumber(row.amount_litres),
    transferDate: asString(row.transfer_date),
    transferTime: asString(row.transfer_time),
    location: asString(row.location),
    notes: asString(row.notes),
    createdBy: asString(row.created_by) || null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function setupFromRows(settingsRow: DatabaseRow | null, tankRows: DatabaseRow[]): FuelSetup {
  const tanks = tankRows.map(mapTank);
  return {
    settings: settingsRow ? mapSettings(settingsRow) : null,
    tanks,
    totalCapacityLitres: tanks.reduce((total, tank) => total + tank.capacityLitres, 0),
  };
}

function toTankRow(input: FuelTankInput): Record<string, unknown> {
  assertTankInput(input);
  return {
    name: input.name.trim(),
    location: input.location?.trim() ?? '',
    description: input.description?.trim() ?? '',
    capacity_litres: input.capacityLitres,
  };
}

function toLogEntries(entries: FuelLogTankEntryInput[]): Array<Record<string, unknown>> {
  assertEntries(entries);
  return entries.map((entry) => ({
    fuel_tank_id: entry.fuelTankId,
    amount_litres: entry.amountLitres,
  }));
}

class FuelManagementService {
  async getSettings(vesselId: string): Promise<VesselFuelSettings | null> {
    const { data, error } = await supabase
      .from('vessel_fuel_settings')
      .select('*')
      .eq('vessel_id', vesselId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapSettings(data) : null;
  }

  async saveSettings(input: {
    vesselId: string;
    volumeUnit: FuelVolumeUnit;
  }): Promise<VesselFuelSettings> {
    const { data, error } = await supabase
      .from('vessel_fuel_settings')
      .upsert(
        { vessel_id: input.vesselId, volume_unit: input.volumeUnit },
        { onConflict: 'vessel_id' }
      )
      .select('*')
      .single();
    if (error) throw error;
    return mapSettings(data);
  }

  async getTanks(vesselId: string): Promise<FuelTank[]> {
    const { data, error } = await supabase
      .from('fuel_tanks')
      .select('*')
      .eq('vessel_id', vesselId)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapTank);
  }

  async getSetup(vesselId: string): Promise<FuelSetup> {
    const [settings, tanks] = await Promise.all([
      this.getSettings(vesselId),
      this.getTanks(vesselId),
    ]);
    return {
      settings,
      tanks,
      totalCapacityLitres: tanks.reduce((total, tank) => total + tank.capacityLitres, 0),
    };
  }

  async saveSetup(input: SaveFuelSetupInput): Promise<FuelSetup> {
    const normalizedNames = new Set<string>();
    const seenIds = new Set<string>();
    const tanks = input.tanks.map((tank) => {
      assertTankInput(tank);
      if (tank.id) {
        if (seenIds.has(tank.id)) throw new Error('Fuel setup contains duplicate tank IDs.');
        seenIds.add(tank.id);
      }
      const normalizedName = tank.name.trim().toLocaleLowerCase();
      if (normalizedNames.has(normalizedName)) {
        throw new Error('Fuel setup contains duplicate tank names.');
      }
      normalizedNames.add(normalizedName);
      return { id: tank.id ?? null, ...toTankRow(tank) };
    });

    const { data, error } = await supabase.rpc('save_vessel_fuel_setup', {
      p_vessel_id: input.vesselId,
      p_volume_unit: input.volumeUnit,
      p_tanks: tanks,
    });
    if (error) throw error;

    const result = data as FuelSetupRpcResult;
    return setupFromRows(result.settings, result.tanks ?? []);
  }

  async createTank(input: FuelTankInput & { vesselId: string }): Promise<FuelTank> {
    const { data, error } = await supabase
      .from('fuel_tanks')
      .insert({ vessel_id: input.vesselId, ...toTankRow(input) })
      .select('*')
      .single();
    if (error) throw error;
    return mapTank(data);
  }

  async updateTank(id: string, input: FuelTankInput): Promise<void> {
    const { data, error } = await supabase
      .from('fuel_tanks')
      .update(toTankRow(input))
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Updating fuel tank');
  }

  async deleteTank(id: string): Promise<void> {
    const { data, error } = await supabase.from('fuel_tanks').delete().eq('id', id).select('id');
    requireAffectedRows(data, error, 'Deleting fuel tank');
  }

  async getLogTankEntries(fuelLogId: string): Promise<FuelLogTankEntry[]> {
    const { data, error } = await supabase
      .from('fuel_log_tank_entries')
      .select('*')
      .eq('fuel_log_id', fuelLogId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapLogTankEntry);
  }

  /**
   * Fetches the vessel's display unit and all requested fuel-log allocations in
   * a fixed number of requests. Tank names are joined by PostgREST, avoiding a
   * per-log or per-tank request when rendering history and PDF exports.
   */
  async getFuelLogAllocationSnapshot(
    vesselId: string,
    fuelLogIds?: readonly string[]
  ): Promise<FuelLogAllocationSnapshot> {
    const uniqueLogIds = fuelLogIds ? [...new Set(fuelLogIds.filter(Boolean))] : undefined;
    const baseEntriesQuery = supabase
      .from('fuel_log_tank_entries')
      .select(
        'fuel_log_id, fuel_tank_id, amount_litres, fuel_tank:fuel_tanks!fuel_log_tank_entries_fuel_tank_id_fkey(name)'
      )
      .eq('vessel_id', vesselId);

    const entriesRequest =
      uniqueLogIds?.length === 0
        ? Promise.resolve({ data: [] as DatabaseRow[], error: null })
        : (uniqueLogIds
            ? baseEntriesQuery.in('fuel_log_id', uniqueLogIds)
            : baseEntriesQuery
          ).order('created_at', { ascending: true });

    const [settings, entriesResponse] = await Promise.all([
      this.getSettings(vesselId),
      entriesRequest,
    ]);
    if (entriesResponse.error) throw entriesResponse.error;

    const allocationsByLogId: FuelLogAllocationSnapshot['allocationsByLogId'] = {};
    for (const row of entriesResponse.data ?? []) {
      const allocation = mapLogTankAllocation(row as DatabaseRow);
      if (!allocation.fuelLogId) continue;
      (allocationsByLogId[allocation.fuelLogId] ??= []).push(allocation);
    }

    return {
      displayUnit: settings?.volumeUnit ?? 'LITRES',
      allocationsByLogId,
    };
  }

  async createFuelLogWithTankEntries(input: CreateFuelLogWithTankEntriesInput): Promise<FuelLog> {
    assertEntries(input.entries);
    if (!input.log.volumeUnit) {
      throw new Error('Tank-aware fuel logs require a volume unit.');
    }
    const { data, error } = await supabase.rpc('create_fuel_log_with_tank_entries', {
      p_log: {
        vessel_id: input.log.vesselId,
        location_of_refueling: input.log.locationOfRefueling.trim() || null,
        log_date: input.log.logDate,
        log_time: input.log.logTime,
        amount_of_fuel: input.log.amountOfFuel,
        price_per_gallon: input.log.pricePerGallon,
        total_price: input.log.totalPrice,
        volume_unit: input.log.volumeUnit,
        currency_code: normalizeCurrencyCode(input.log.currencyCode),
        comment: input.log.comment?.trim() || '',
      },
      p_entries: toLogEntries(input.entries),
    });
    if (error) throw error;
    return mapFuelLog(data);
  }

  async updateFuelLogWithTankEntries(
    id: string,
    input: UpdateFuelLogWithTankEntriesInput
  ): Promise<void> {
    assertEntries(input.entries);
    const patch: Record<string, unknown> = {};
    if (input.log.locationOfRefueling !== undefined)
      patch.location_of_refueling = input.log.locationOfRefueling.trim() || null;
    if (input.log.logDate !== undefined) patch.log_date = input.log.logDate;
    if (input.log.logTime !== undefined) patch.log_time = input.log.logTime;
    if (input.log.amountOfFuel !== undefined) patch.amount_of_fuel = input.log.amountOfFuel;
    if (input.log.pricePerGallon !== undefined) patch.price_per_gallon = input.log.pricePerGallon;
    if (input.log.totalPrice !== undefined) patch.total_price = input.log.totalPrice;
    if (input.log.volumeUnit !== undefined) patch.volume_unit = input.log.volumeUnit;
    if (input.log.currencyCode !== undefined)
      patch.currency_code = normalizeCurrencyCode(input.log.currencyCode);
    if (input.log.comment !== undefined) patch.comment = input.log.comment.trim();

    const { error } = await supabase.rpc('update_fuel_log_with_tank_entries', {
      p_fuel_log_id: id,
      p_vessel_id: input.vesselId,
      p_log_patch: patch,
      p_entries: toLogEntries(input.entries),
    });
    if (error) throw error;
  }

  async getTransfersByVessel(vesselId: string): Promise<FuelTransfer[]> {
    const { data, error } = await supabase
      .from('fuel_transfers')
      .select('*')
      .eq('vessel_id', vesselId)
      .order('transfer_date', { ascending: false })
      .order('transfer_time', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapTransfer);
  }

  async getTransferById(id: string): Promise<FuelTransfer | null> {
    const { data, error } = await supabase
      .from('fuel_transfers')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapTransfer(data) : null;
  }

  async createTransfer(input: FuelTransferInput): Promise<FuelTransfer> {
    if (input.sourceTankId === input.destinationTankId) {
      throw new Error('Source and destination tanks must be different.');
    }
    if (!Number.isFinite(input.amountLitres) || input.amountLitres <= 0) {
      throw new Error('Transfer amount must be greater than zero litres.');
    }
    const { data, error } = await supabase
      .from('fuel_transfers')
      .insert({
        vessel_id: input.vesselId,
        source_tank_id: input.sourceTankId,
        destination_tank_id: input.destinationTankId,
        amount_litres: input.amountLitres,
        transfer_date: input.transferDate,
        transfer_time: input.transferTime,
        location: input.location?.trim() || '',
        notes: input.notes?.trim() || '',
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapTransfer(data);
  }

  async updateTransfer(id: string, input: FuelTransferInput): Promise<void> {
    if (input.sourceTankId === input.destinationTankId) {
      throw new Error('Source and destination tanks must be different.');
    }
    if (!Number.isFinite(input.amountLitres) || input.amountLitres <= 0) {
      throw new Error('Transfer amount must be greater than zero litres.');
    }
    const { data, error } = await supabase
      .from('fuel_transfers')
      .update({
        vessel_id: input.vesselId,
        source_tank_id: input.sourceTankId,
        destination_tank_id: input.destinationTankId,
        amount_litres: input.amountLitres,
        transfer_date: input.transferDate,
        transfer_time: input.transferTime,
        location: input.location?.trim() || '',
        notes: input.notes?.trim() || '',
      })
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Updating fuel transfer');
  }

  async deleteTransfer(id: string): Promise<void> {
    const { data, error } = await supabase
      .from('fuel_transfers')
      .delete()
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Deleting fuel transfer');
  }

  async getTankBalances(vesselId: string): Promise<FuelTankBalance[]> {
    const [tanks, allocationsResponse, transfers] = await Promise.all([
      this.getTanks(vesselId),
      supabase.from('fuel_log_tank_entries').select('*').eq('vessel_id', vesselId),
      this.getTransfersByVessel(vesselId),
    ]);
    if (allocationsResponse.error) throw allocationsResponse.error;

    const balanceByTankId = new Map<string, number>();
    for (const allocation of allocationsResponse.data ?? []) {
      const current = balanceByTankId.get(allocation.fuel_tank_id) ?? 0;
      balanceByTankId.set(allocation.fuel_tank_id, current + asNumber(allocation.amount_litres));
    }
    for (const transfer of transfers) {
      balanceByTankId.set(
        transfer.sourceTankId,
        (balanceByTankId.get(transfer.sourceTankId) ?? 0) - transfer.amountLitres
      );
      balanceByTankId.set(
        transfer.destinationTankId,
        (balanceByTankId.get(transfer.destinationTankId) ?? 0) + transfer.amountLitres
      );
    }

    return tanks.map((tank) => {
      const recordedVolumeLitres = balanceByTankId.get(tank.id) ?? 0;
      return {
        tank,
        recordedVolumeLitres,
        remainingCapacityLitres: tank.capacityLitres - recordedVolumeLitres,
      };
    });
  }
}

export const fuelManagementService = new FuelManagementService();

export default fuelManagementService;
