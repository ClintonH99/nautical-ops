/**
 * Safety Equipment Service
 * Published safety equipment location plans for vessels
 */

import { supabase } from './supabase';

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

export interface SafetyEquipmentData {
  vesselName?: string;
  [key: string]: string[] | string | undefined;
}

export interface SafetyEquipment {
  id: string;
  vesselId: string;
  title: string;
  data: SafetyEquipmentData;
  createdAt: string;
}

class SafetyEquipmentService {
  private mapRow(row: any): SafetyEquipment {
    return {
      id: row.id,
      vesselId: row.vessel_id,
      title: row.title,
      data: row.data || {},
      createdAt: row.created_at,
    };
  }

  async getByVessel(vesselId: string): Promise<SafetyEquipment[]> {
    const { data, error } = await supabase
      .from('safety_equipment')
      .select('*')
      .eq('vessel_id', vesselId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((r) => this.mapRow(r));
  }

  async getById(id: string): Promise<SafetyEquipment | null> {
    const { data, error } = await supabase
      .from('safety_equipment')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return null;
    return this.mapRow(data);
  }

  async create(vesselId: string, title: string, data: SafetyEquipmentData, createdBy?: string): Promise<SafetyEquipment> {
    const { data: row, error } = await supabase
      .from('safety_equipment')
      .insert([{ vessel_id: vesselId, title, data, created_by: createdBy || null }])
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(row);
  }

  async update(id: string, title: string, data: SafetyEquipmentData): Promise<SafetyEquipment> {
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
    const { error } = await supabase
      .from('safety_equipment')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}

export default new SafetyEquipmentService();
