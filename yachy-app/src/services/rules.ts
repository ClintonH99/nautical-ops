/**
 * Rules Service
 * Published vessel rules for crew to conform to
 */

import { supabase } from './supabase';

export interface Rule {
  id: string;
  vesselId: string;
  title: string;
  data: { title: string; rules: string[] };
  createdAt: string;
}

class RulesService {
  private mapRow(row: any): Rule {
    return {
      id: row.id,
      vesselId: row.vessel_id,
      title: row.title,
      data: row.data || { title: '', rules: [] },
      createdAt: row.created_at,
    };
  }

  async getByVessel(vesselId: string): Promise<Rule[]> {
    const { data, error } = await supabase
      .from('rules')
      .select('*')
      .eq('vessel_id', vesselId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((r) => this.mapRow(r));
  }

  async getById(id: string): Promise<Rule | null> {
    const { data, error } = await supabase
      .from('rules')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return null;
    return this.mapRow(data);
  }

  async create(vesselId: string, title: string, rules: string[], createdBy?: string): Promise<Rule> {
    const { data: row, error } = await supabase
      .from('rules')
      .insert([{ vessel_id: vesselId, title, data: { title, rules }, created_by: createdBy || null }])
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(row);
  }

  async update(id: string, title: string, rules: string[]): Promise<Rule> {
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
    const { error } = await supabase
      .from('rules')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}

export default new RulesService();
