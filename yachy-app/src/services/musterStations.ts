/**
 * Muster Stations Service
 * Published muster station plans for vessels
 */

import { supabase } from './supabase';

export interface MusterStationData {
  vesselName: string;
  musterStation: string;
  medicalChest: string[];
  grabBag: string[];
  grabBagContents: string;
  lifeRings: string[];
  emergencySignals: {
    fire: string;
    manOverboard: string;
    grounding: string;
    abandonShip: string;
    medical: string;
  };
  crewMembers: Array<{
    roleName: string;
    fire: string;
    manOverboard: string;
    grounding: string;
    abandonShip: string;
    medical: string;
  }>;
}

export interface MusterStation {
  id: string;
  vesselId: string;
  title: string;
  data: MusterStationData;
  createdAt: string;
}

class MusterStationsService {
  private mapRow(row: any): MusterStation {
    return {
      id: row.id,
      vesselId: row.vessel_id,
      title: row.title,
      data: row.data || {},
      createdAt: row.created_at,
    };
  }

  async getByVessel(vesselId: string): Promise<MusterStation[]> {
    const { data, error } = await supabase
      .from('muster_stations')
      .select('*')
      .eq('vessel_id', vesselId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((r) => this.mapRow(r));
  }

  async getById(id: string): Promise<MusterStation | null> {
    const { data, error } = await supabase
      .from('muster_stations')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return null;
    return this.mapRow(data);
  }

  async create(vesselId: string, title: string, data: MusterStationData, createdBy?: string): Promise<MusterStation> {
    const { data: row, error } = await supabase
      .from('muster_stations')
      .insert([{ vessel_id: vesselId, title, data, created_by: createdBy || null }])
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(row);
  }

  async update(id: string, title: string, data: MusterStationData): Promise<MusterStation> {
    const { data: row, error } = await supabase
      .from('muster_stations')
      .update({ title, data })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(row);
  }

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('muster_stations')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}

export default new MusterStationsService();
