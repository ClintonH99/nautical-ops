/**
 * Pre-Departure Checklists Service
 * CRUD for pre-departure checklists and their items
 */

import { supabase } from './supabase';
import { PreDepartureChecklist, PreDepartureChecklistItem, Department } from '../types';

export interface CreatePreDepartureChecklistData {
  vesselId: string;
  tripId?: string | null;
  department?: Department | null;
  title: string;
  items: { label: string }[];
}

export interface UpdatePreDepartureChecklistData {
  title?: string;
  tripId?: string | null;
  department?: Department | null;
}

class PreDepartureChecklistsService {
  private mapItem(row: any): PreDepartureChecklistItem {
    return {
      id: row.id,
      checklistId: row.checklist_id,
      label: row.label ?? '',
      sortOrder: row.sort_order ?? 0,
      checked: row.checked ?? false,
      createdAt: row.created_at,
    };
  }

  async getByVessel(vesselId: string): Promise<PreDepartureChecklist[]> {
    try {
      const { data: checklists, error: listsError } = await supabase
        .from('pre_departure_checklists')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('created_at', { ascending: false });

      if (listsError) throw listsError;
      if (!checklists?.length) return [];

      const { data: items, error: itemsError } = await supabase
        .from('pre_departure_checklist_items')
        .select('*')
        .in('checklist_id', checklists.map((c) => c.id))
        .order('sort_order', { ascending: true });

      if (itemsError) throw itemsError;
      const itemsByChecklist: Record<string, PreDepartureChecklistItem[]> = {};
      (items || []).forEach((r) => {
        const item = this.mapItem(r);
        if (!itemsByChecklist[r.checklist_id]) itemsByChecklist[r.checklist_id] = [];
        itemsByChecklist[r.checklist_id].push(item);
      });

      return checklists.map((c) => ({
        id: c.id,
        vesselId: c.vessel_id,
        tripId: c.trip_id ?? null,
        department: (c.department as Department) ?? null,
        title: c.title,
        items: itemsByChecklist[c.id] ?? [],
        createdAt: c.created_at,
        createdBy: c.created_by,
      }));
    } catch (error) {
      console.error('Get pre-departure checklists error:', error);
      return [];
    }
  }

  async getById(id: string): Promise<PreDepartureChecklist | null> {
    try {
      const { data: checklist, error: listError } = await supabase
        .from('pre_departure_checklists')
        .select('*')
        .eq('id', id)
        .single();

      if (listError || !checklist) return null;

      const { data: items, error: itemsError } = await supabase
        .from('pre_departure_checklist_items')
        .select('*')
        .eq('checklist_id', id)
        .order('sort_order', { ascending: true });

      if (itemsError) return null;

      return {
        id: checklist.id,
        vesselId: checklist.vessel_id,
        tripId: checklist.trip_id ?? null,
        department: (checklist.department as Department) ?? null,
        title: checklist.title,
        items: (items || []).map(this.mapItem),
        createdAt: checklist.created_at,
        createdBy: checklist.created_by,
      };
    } catch (error) {
      console.error('Get pre-departure checklist error:', error);
      return null;
    }
  }

  async create(input: CreatePreDepartureChecklistData): Promise<PreDepartureChecklist> {
    const { data: checklist, error: listError } = await supabase
      .from('pre_departure_checklists')
      .insert([
        {
          vessel_id: input.vesselId,
          trip_id: input.tripId ?? null,
          department: input.department ?? null,
          title: input.title.trim(),
          created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        },
      ])
      .select()
      .single();

    if (listError) throw listError;

    if (input.items.length > 0) {
      await supabase.from('pre_departure_checklist_items').insert(
        input.items.map((item, idx) => ({
          checklist_id: checklist.id,
          label: item.label.trim(),
          sort_order: idx,
          checked: false,
        }))
      );
    }

    const created = await this.getById(checklist.id);
    if (!created) throw new Error('Failed to fetch created checklist');
    return created;
  }

  async update(id: string, input: UpdatePreDepartureChecklistData): Promise<void> {
    const patch: Record<string, any> = {};
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.tripId !== undefined) patch.trip_id = input.tripId ?? null;
    if (input.department !== undefined) patch.department = input.department ?? null;

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from('pre_departure_checklists').update(patch).eq('id', id);
      if (error) throw error;
    }
  }

  async updateItemChecked(itemId: string, checked: boolean): Promise<void> {
    const { error } = await supabase
      .from('pre_departure_checklist_items')
      .update({ checked })
      .eq('id', itemId);
    if (error) throw error;
  }

  async addItem(checklistId: string, label: string): Promise<PreDepartureChecklistItem> {
    const { data: max } = await supabase
      .from('pre_departure_checklist_items')
      .select('sort_order')
      .eq('checklist_id', checklistId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single();

    const order = (max?.sort_order ?? -1) + 1;
    const { data, error } = await supabase
      .from('pre_departure_checklist_items')
      .insert([{ checklist_id: checklistId, label: label.trim(), sort_order: order, checked: false }])
      .select()
      .single();

    if (error) throw error;
    return this.mapItem(data);
  }

  async deleteItem(itemId: string): Promise<void> {
    const { error } = await supabase.from('pre_departure_checklist_items').delete().eq('id', itemId);
    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('pre_departure_checklists').delete().eq('id', id);
    if (error) throw error;
  }
}

export default new PreDepartureChecklistsService();
