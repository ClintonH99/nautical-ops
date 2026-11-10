import { offlineVesselRecords } from '../offline/vesselRecordService';
const offline = offlineVesselRecords('uniforms');
/**
 * Uniforms Service
 * Each row is one label (e.g. "Swimwear", "Boss uniform") with its own
 * set of structured entries: amount, size, color, gender note, and an
 * optional day/night note - all free text, per-vessel design choice.
 */
import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';
import { Department } from '../types';

export interface UniformEntry {
  amount: string;
  size: string;
  color: string;
  gender: string;
  dayNight?: string;
}

export interface Uniform {
  offlineLocalVersion?: number;
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
    offlineLocalVersion: row.offlineLocalVersion,
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
  subscribe: offline.subscribe,
  async getByVessel(vesselId: string): Promise<Uniform[]> {
    if (offline.enabled()) return (await offline.list(vesselId)).map(mapRow);
    const { data, error } = await supabase
      .from('uniforms')
      .select('*')
      .eq('vessel_id', vesselId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  },

  async getById(id: string): Promise<Uniform | null> {
    if (offline.enabled()) {
      const row = await offline.read(id);
      return row ? mapRow(row) : null;
    }
    const { data, error } = await supabase.from('uniforms').select('*').eq('id', id).maybeSingle();
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
    if (offline.enabled())
      return mapRow(
        await offline.create({
          vessel_id: input.vesselId,
          label: input.label,
          department: input.department,
          entries: input.entries.map((e) => ({ ...e })),
        })
      );
    const { data, error } = await supabase
      .from('uniforms')
      .insert([
        {
          vessel_id: input.vesselId,
          label: input.label,
          department: input.department,
          entries: input.entries,
          created_by: input.createdBy || null,
        },
      ])
      .select()
      .single();
    if (error) throw error;
    return mapRow(data);
  },

  async update(
    id: string,
    input: {
      label: string;
      department: Department;
      entries: UniformEntry[];
    },
    version?: number
  ): Promise<Uniform> {
    if (offline.enabled())
      return mapRow(
        await offline.update(
          id,
          {
            label: input.label,
            department: input.department,
            entries: input.entries.map((e) => ({ ...e })),
          },
          version
        )
      );
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
    if (offline.enabled()) await offline.beforeDelete(id);
    const { data, error } = await supabase.from('uniforms').delete().eq('id', id).select('id');
    requireAffectedRows(data, error, 'Deleting the uniform record');
    if (offline.enabled()) await offline.refresh();
  },
};

export default uniformsService;
