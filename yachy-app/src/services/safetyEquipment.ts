/**
 * Safety Equipment Service
 * Published safety equipment location plans for vessels
 */

import { offlinePublications } from '../offline/publicationsService';
const offline = offlinePublications('safetyEquipment');
import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';

export type SafetyEquipmentCategories = {
  fireExtinguishers: string[];
  firstAidKits: string[];
  medicalBags: string[];
  fireFightingEquipment: string[];
  lifeRings: string[];
  lifeRafts: string[];
  bilgePumps: string[];
  fireHoses: string[];
  emergencyOff: string[];
  fireAlarmPanel: string[];
  fireAlarmSwitches: string[];
  flares: string[];
  epirbs: string[];
};

export interface SafetyItem {
  location: string;
  lastChecked: string | null;
  lastCheckedNA: boolean;
  expiryDate: string | null;
  expiryDateNA: boolean;
}

export function normalizeSafetyItem(raw: string | SafetyItem): SafetyItem {
  if (typeof raw === 'string') {
    return {
      location: raw,
      lastChecked: null,
      lastCheckedNA: false,
      expiryDate: null,
      expiryDateNA: false,
    };
  }
  return {
    location: raw.location ?? '',
    lastChecked: raw.lastChecked ?? null,
    lastCheckedNA: raw.lastCheckedNA ?? false,
    expiryDate: raw.expiryDate ?? null,
    expiryDateNA: raw.expiryDateNA ?? false,
  };
}

export interface SafetyEquipmentData {
  vesselName?: string;
  customLabels?: Record<string, string>;
  categoryOrder?: string[];
  [key: string]: (string | SafetyItem)[] | string | Record<string, string> | undefined;
}

const SAFETY_EQUIPMENT_METADATA_KEYS = new Set(['vesselName', 'customLabels', 'categoryOrder']);

/**
 * Returns the saved category order exactly when present. Older records did not
 * store an order, so they fall back to their saved category keys instead of
 * silently restoring categories that the user may have removed.
 */
export function getSafetyEquipmentCategoryOrder(
  data: SafetyEquipmentData,
  preferredLegacyOrder: string[] = []
): string[] {
  const uniqueKeys = (keys: string[]) =>
    Array.from(new Set(keys.filter((key) => key && !SAFETY_EQUIPMENT_METADATA_KEYS.has(key))));

  if (Array.isArray(data.categoryOrder)) {
    return uniqueKeys(data.categoryOrder.filter((key): key is string => typeof key === 'string'));
  }

  const legacyKeys = Object.keys(data).filter(
    (key) => !SAFETY_EQUIPMENT_METADATA_KEYS.has(key) && Array.isArray(data[key])
  );
  const legacyKeySet = new Set(legacyKeys);

  return uniqueKeys([
    ...preferredLegacyOrder.filter((key) => legacyKeySet.has(key)),
    ...legacyKeys,
  ]);
}

export interface SafetyEquipment {
  id: string;
  vesselId: string;
  title: string;
  data: SafetyEquipmentData;
  createdAt: string;
  offlineLocalVersion?: number;
}

class SafetyEquipmentService {
  private mapRow(row: any): SafetyEquipment {
    return {
      id: row.id,
      vesselId: row.vessel_id,
      title: row.title,
      data: row.data || {},
      createdAt: row.created_at,
      offlineLocalVersion: row.offlineLocalVersion,
    };
  }

  subscribe = offline.subscribe;
  async getVesselName(vesselId: string): Promise<string> {
    if (offline.enabled()) return offline.vesselName(vesselId);
    const { data, error } = await supabase
      .from('vessels')
      .select('id,name')
      .eq('id', vesselId)
      .single();
    if (error) throw error;
    return typeof data?.name === 'string' ? data.name : '';
  }
  async getByVessel(vesselId: string): Promise<SafetyEquipment[]> {
    if (offline.enabled()) return (await offline.list(vesselId)).map((row) => this.mapRow(row));
    const { data, error } = await supabase
      .from('safety_equipment')
      .select('*')
      .eq('vessel_id', vesselId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((r) => this.mapRow(r));
  }

  async getById(id: string): Promise<SafetyEquipment | null> {
    if (offline.enabled()) {
      const row = await offline.read(id);
      return row ? this.mapRow(row) : null;
    }
    const { data, error } = await supabase
      .from('safety_equipment')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return null;
    return this.mapRow(data);
  }

  async create(
    vesselId: string,
    title: string,
    data: SafetyEquipmentData,
    createdBy?: string
  ): Promise<SafetyEquipment> {
    if (offline.enabled())
      return this.mapRow(
        await offline.create({ vessel_id: vesselId, title, data: JSON.parse(JSON.stringify(data)) })
      );
    const { data: row, error } = await supabase
      .from('safety_equipment')
      .insert([{ vessel_id: vesselId, title, data, created_by: createdBy || null }])
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(row);
  }

  async update(
    id: string,
    title: string,
    data: SafetyEquipmentData,
    version?: number
  ): Promise<SafetyEquipment> {
    if (offline.enabled())
      return this.mapRow(
        await offline.update(id, { title, data: JSON.parse(JSON.stringify(data)) }, version)
      );
    const { data: row, error } = await supabase
      .from('safety_equipment')
      .update({ title, data })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(row);
  }

  async delete(id: string): Promise<void> {
    if (offline.enabled()) await offline.beforeDelete(id);
    const { data, error } = await supabase
      .from('safety_equipment')
      .delete()
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Deleting the safety equipment record');
    if (offline.enabled()) await offline.refresh();
  }
}

export default new SafetyEquipmentService();
