/**
 * Uniforms Service
 * Each row is one label (e.g. "Swimwear", "Boss uniform") with its own
 * set of structured entries: amount, size, color, gender note, and an
 * optional day/night note - all free text, per-vessel design choice.
 */
import { supabase } from './supabase';
import { Department } from '../types';

export interface UniformEntry {
  amount: string;
  size: string;
  color: string;
  gender: string;
  dayNight?: string;
}

export interface Uniform {
  id: string;
  vesselId: string;
  label: string;
  department: Department;
  entries: UniformEntry[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: any): Uniform {
  return {
    id: row.id,
    vesselId: row.vessel_id,
    label: row.label,
    department: row.department,
    entries: row.entries ?? [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const uniformsService = {
  async getByVessel(vesselId: string): Promise<Uniform[]> {
    const { data, error } = await supabase
      .from('uniforms')
      .select('*')
      .eq('vessel_id', vesselId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  },

  async getById(id: string): Promise<Uniform | null> {
    const { data, error } = await supabase
      .from('uniforms')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data) : null;
  },

  async create(input: {
    vesselId: string;
    label: string;
    department: Department;
    entries: UniformEntry[];
    createdBy?: string;
  }): Promise<Uniform> {
    const { data, error } = await supabase
      .from('uniforms')
      .insert([{
        vessel_id: input.vesselId,
        label: input.label,
        department: input.department,
        entries: input.entries,
        created_by: input.createdBy || null,
      }])
      .select()
      .single();
    if (error) throw error;
    return mapRow(data);
  },

  async update(id: string, input: {
    label: string;
    department: Department;
    entries: UniformEntry[];
  }): Promise<Uniform> {
    const { data, error } = await supabase
      .from('uniforms')
      .update({
        label: input.label,
        department: input.department,
        entries: input.entries,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return mapRow(data);
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('uniforms').delete().eq('id', id);
    if (error) throw error;
  },
};

export default uniformsService;
