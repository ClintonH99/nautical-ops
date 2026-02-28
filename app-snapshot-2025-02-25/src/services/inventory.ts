/**
 * Inventory Items Service
 * Per vessel: title, description, location, department, amount/item rows
 */

import { supabase } from './supabase';
import { Department } from '../types';

export interface InventoryItemRow {
  amount: string;
  item: string;
}

export interface InventoryItem {
  id: string;
  vesselId: string;
  department: Department;
  title: string;
  description: string;
  location: string;
  items: InventoryItemRow[];
  createdAt: string;
}

export interface CreateInventoryItemInput {
  vesselId: string;
  department: Department;
  title: string;
  description: string;
  location: string;
  items: InventoryItemRow[];
  /** Sent as last_edited_by_name for DB NOT NULL (legacy schema). */
  lastEditedByName?: string;
}

const ALLOWED_DEPARTMENTS: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];

/** Ensure department matches DB check constraint inventory_items_department_check. */
function normalizeDepartment(dept: string | undefined): Department {
  const u = (dept ?? '').trim().toUpperCase();
  return ALLOWED_DEPARTMENTS.includes(u as Department) ? (u as Department) : 'INTERIOR';
}

function normalizeRows(raw: unknown): InventoryItemRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (entry && typeof entry === 'object' && 'amount' in entry && 'item' in entry) {
      const e = entry as InventoryItemRow;
      return { amount: String(e.amount ?? ''), item: String(e.item ?? '') };
    }
    return { amount: '', item: '' };
  });
}

class InventoryService {
  async getByVessel(vesselId: string): Promise<InventoryItem[]> {
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(this.mapRow);
    } catch (e) {
      console.error('Get inventory items error:', e);
      return [];
    }
  }

  async getById(id: string): Promise<InventoryItem | null> {
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('id', id)
        .single();
      if (error || !data) return null;
      return this.mapRow(data);
    } catch (e) {
      console.error('Get inventory item error:', e);
      return null;
    }
  }

  async create(input: CreateInventoryItemInput): Promise<InventoryItem> {
    const items = input.items
      .filter((row) => row.amount.trim() || row.item.trim())
      .map((row) => ({ amount: row.amount.trim(), item: row.item.trim() }));
    const titleVal = input.title.trim();
    const payload: Record<string, unknown> = {
      vessel_id: input.vesselId,
      department: normalizeDepartment(input.department),
      title: titleVal,
      description: (input.description || '').trim(),
      location: (input.location || '').trim(),
      items,
    };
    if (titleVal) payload.name = titleVal; // DB may have NOT NULL name (legacy)
    payload.last_edited_by_name = (input.lastEditedByName ?? '').trim() || 'Unknown';
    const { data, error } = await supabase
      .from('inventory_items')
      .insert([payload])
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(data);
  }

  async update(
    id: string,
    updates: {
      title?: string;
      description?: string;
      location?: string;
      department?: Department;
      items?: InventoryItemRow[];
      /** Sent as last_edited_by_name for DB NOT NULL (legacy schema). */
      lastEditedByName?: string;
    }
  ): Promise<InventoryItem> {
    const payload: Record<string, unknown> = {};
    if (updates.title !== undefined) {
      const t = updates.title.trim();
      payload.title = t;
      if (t) payload.name = t;
    }
    if (updates.description !== undefined) payload.description = updates.description.trim();
    if (updates.location !== undefined) payload.location = updates.location.trim();
    if (updates.department !== undefined) payload.department = normalizeDepartment(updates.department);
    if (updates.items !== undefined) {
      payload.items = updates.items
        .filter((row) => row.amount.trim() || row.item.trim())
        .map((row) => ({ amount: row.amount.trim(), item: row.item.trim() }));
    }
    payload.last_edited_by_name = (updates.lastEditedByName ?? '').trim() || 'Unknown';
    const { data, error } = await supabase
      .from('inventory_items')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return this.mapRow(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('inventory_items')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  private mapRow(row: Record<string, unknown>): InventoryItem {
    return {
      id: row.id as string,
      vesselId: row.vessel_id as string,
      department: row.department as Department,
      title: (row.title ?? row.name ?? '') as string,
      description: (row.description as string) || '',
      location: (row.location as string) || '',
      items: normalizeRows(row.items),
      createdAt: row.created_at as string,
    };
  }
}

export default new InventoryService();
