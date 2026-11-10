/**
 * Rules Service
 * Published vessel rules for crew to conform to
 */

import { offlinePublications } from '../offline/publicationsService';
const offline = offlinePublications('rules');
import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';

export interface Rule {
  id: string;
  vesselId: string;
  title: string;
  data: { title: string; rules: string[] };
  createdAt: string;
  offlineLocalVersion?: number;
}

class RulesService {
  private mapRow(row: any): Rule {
    return {
      id: row.id,
      vesselId: row.vessel_id,
      title: row.title,
      data: row.data || { title: '', rules: [] },
      createdAt: row.created_at,
      offlineLocalVersion: row.offlineLocalVersion,
    };
  }

  subscribe = offline.subscribe;
  async getByVessel(vesselId: string): Promise<Rule[]> {
    if (offline.enabled()) return (await offline.list(vesselId)).map((row) => this.mapRow(row));
    const { data, error } = await supabase
      .from('rules')
      .select('*')
      .eq('vessel_id', vesselId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((r) => this.mapRow(r));
  }

  async getById(id: string): Promise<Rule | null> {
    if (offline.enabled()) {
      const row = await offline.read(id);
      return row ? this.mapRow(row) : null;
    }
    const { data, error } = await supabase.from('rules').select('*').eq('id', id).single();

    if (error || !data) return null;
    return this.mapRow(data);
  }

  async create(
    vesselId: string,
    title: string,
    rules: string[],
    createdBy?: string
  ): Promise<Rule> {
    if (offline.enabled())
      return this.mapRow(
        await offline.create({ vessel_id: vesselId, title, data: { title, rules } })
      );
    const { data: row, error } = await supabase
      .from('rules')
      .insert([
        { vessel_id: vesselId, title, data: { title, rules }, created_by: createdBy || null },
      ])
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(row);
  }

  async update(id: string, title: string, rules: string[], version?: number): Promise<Rule> {
    if (offline.enabled())
      return this.mapRow(await offline.update(id, { title, data: { title, rules } }, version));
    const { data: row, error } = await supabase
      .from('rules')
      .update({ title, data: { title, rules } })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(row);
  }

  async delete(id: string): Promise<void> {
    if (offline.enabled()) await offline.beforeDelete(id);
    const { data, error } = await supabase.from('rules').delete().eq('id', id).select('id');
    requireAffectedRows(data, error, 'Deleting the rule');
    if (offline.enabled()) await offline.refresh();
  }
}

export default new RulesService();
