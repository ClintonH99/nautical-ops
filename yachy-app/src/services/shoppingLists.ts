/**
 * Shopping Lists Service
 * Create and fetch shopping lists (title + bullet items) per vessel, filterable by department
 */

import { supabase } from './supabase';
import { Department } from '../types';

export interface ShoppingListItem {
  text: string;
  checked: boolean;
}

export type ShoppingListType = 'general' | 'trip';

export interface ShoppingList {
  id: string;
  vesselId: string;
  department: Department;
  listType: ShoppingListType;
  isMaster?: boolean;
  title: string;
  items: ShoppingListItem[];
  createdAt: string;
  createdBy?: string;
}

export interface CreateShoppingListInput {
  vesselId: string;
  department: Department;
  listType: ShoppingListType;
  title: string;
  items: ShoppingListItem[];
  createdBy?: string;
  isMaster?: boolean;
}

function normalizeItems(raw: unknown): ShoppingListItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (entry && typeof entry === 'object' && 'text' in entry && 'checked' in entry) {
      return { text: String((entry as ShoppingListItem).text), checked: Boolean((entry as ShoppingListItem).checked) };
    }
    return { text: String(entry), checked: false };
  });
}

class ShoppingListsService {
  async getByVessel(vesselId: string): Promise<ShoppingList[]> {
    try {
      const { data, error } = await supabase
        .from('shopping_lists')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(this.mapRow);
    } catch (e) {
      console.error('Get shopping lists error:', e);
      return [];
    }
  }

  async create(input: CreateShoppingListInput): Promise<ShoppingList> {
    const items = input.items
      .filter((item) => item.text.trim().length > 0)
      .map((item) => ({ text: item.text.trim(), checked: item.checked }));
    const { data, error } = await supabase
      .from('shopping_lists')
      .insert([
        {
          vessel_id: input.vesselId,
          department: input.department,
          list_type: input.listType,
          title: input.title.trim(),
          items,
          created_by: input.createdBy || null,
          is_master: input.isMaster ?? false,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(data);
  }

  async update(id: string, updates: { title?: string; items?: ShoppingListItem[] }): Promise<ShoppingList> {
    const payload: Record<string, unknown> = {};
    if (updates.title !== undefined) payload.title = updates.title.trim();
    if (updates.items !== undefined) {
      payload.items = updates.items
        .filter((item) => item.text.trim().length > 0)
        .map((item) => ({ text: item.text.trim(), checked: item.checked }));
    }

    const { data, error } = await supabase
      .from('shopping_lists')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('shopping_lists').delete().eq('id', id);
    if (error) throw error;
  }

  async getOrCreateMasterTripList(vesselId: string, createdBy?: string): Promise<ShoppingList> {
    const existing = await this.getByVessel(vesselId);
    const master = existing.find((l) => l.listType === 'trip' && l.isMaster);
    if (master) return master;
    return this.create({
      vesselId,
      department: 'INTERIOR',
      listType: 'trip',
      title: 'Standard Trip Items',
      items: [{ text: '', checked: false }],
      createdBy,
      isMaster: true,
    });
  }

  private mapRow(row: Record<string, unknown>): ShoppingList {
    const listType = row.list_type as string;
    return {
      id: row.id as string,
      vesselId: row.vessel_id as string,
      department: row.department as Department,
      listType: listType === 'trip' ? 'trip' : 'general',
      isMaster: Boolean(row.is_master),
      title: row.title as string,
      items: normalizeItems(row.items),
      createdAt: row.created_at as string,
      createdBy: row.created_by as string | undefined,
    };
  }
}

export default new ShoppingListsService();
