import { offlineInventory } from '../offline/inventoryService';
/**
 * Inventory Items Service
 * Per vessel: title, description, location, department, amount/item rows
 */

import { supabase, readTransport } from './supabase';
import { requireAffectedRows } from './mutationResult';
import { Department } from '../types';

export interface InventoryItemRow {
  amount: string;
  item: string;
}

export interface InventoryItem {
  offlineLocalVersion?: number;
  id: string;
  vesselId: string;
  department: Department;
  title: string;
  description: string;
  location: string;
  items: InventoryItemRow[];
  createdAt: string;
  lastEditedAt?: string | null;
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

export class InventoryConflictError extends Error {
  constructor() {
    super('This inventory item changed elsewhere or is no longer available.');
    this.name = 'InventoryConflictError';
  }
}

const ALLOWED_DEPARTMENTS: Department[] = [
  'BRIDGE',
  'ENGINEERING',
  'EXTERIOR',
  'INTERIOR',
  'GALLEY',
];

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
  subscribe = offlineInventory.subscribe;
  offlineEnabled = offlineInventory.enabled;
  /** Retriable auto-save: stable create IDs and conditional updates avoid duplicates/overwrites. */
  async autoSave(
    id: string,
    input: CreateInventoryItemInput,
    base: InventoryItem | null
  ): Promise<InventoryItem> {
    const payload = {
      vessel_id: input.vesselId,
      department: normalizeDepartment(input.department),
      title: input.title.trim(),
      name: input.title.trim(),
      location: input.location.trim(),
      description: input.description.trim(),
      items: input.items
        .filter((row) => row.amount.trim() || row.item.trim())
        .map((row) => ({ amount: row.amount.trim(), item: row.item.trim() })),
      last_edited_by_name: input.lastEditedByName?.trim() || 'Unknown',
      last_edited_at: new Date(
        Math.max(Date.now(), (Date.parse(base?.lastEditedAt ?? '') || 0) + 1)
      ).toISOString(),
    };
    if (offlineInventory.enabled()) {
      const b = base
        ? {
            department: base.department,
            title: base.title,
            description: base.description,
            location: base.location,
            items: base.items.map((r) => ({ ...r })),
          }
        : null;
      return this.mapRow(await offlineInventory.save(id, input.vesselId, payload, b));
    }
    if (!payload.title) throw new Error('Please enter a title.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      if (!base) {
        const { data, error } = await supabase
          .from('inventory_items')
          .insert({ id, ...payload })
          .select()
          .abortSignal(controller.signal)
          .single();
        if (!error) return this.mapRow(data);
        if (error.code !== '23505') throw error;
      } else {
        let query = supabase
          .from('inventory_items')
          .update(payload)
          .eq('id', id)
          .eq('vessel_id', input.vesselId);
        query = base.lastEditedAt
          ? query.eq('last_edited_at', base.lastEditedAt)
          : query.is('last_edited_at', null);
        const { data, error } = await query.select().abortSignal(controller.signal).maybeSingle();
        if (error) throw error;
        if (data) return this.mapRow(data);
      }
      // A lost response is successful only if the exact intended contents already exist.
      const current = await this.getFreshById(id, input.vesselId);
      if (
        current &&
        current.title === payload.title &&
        current.department === payload.department &&
        current.location === payload.location &&
        current.description === payload.description &&
        JSON.stringify(current.items) === JSON.stringify(payload.items)
      )
        return current;
      throw new InventoryConflictError();
    } finally {
      clearTimeout(timeout);
    }
  }

  async getFreshById(id: string, vesselId: string): Promise<InventoryItem | null> {
    if (offlineInventory.enabled()) {
      const row = await offlineInventory.read(id, vesselId);
      return row ? this.mapRow(row) : null;
    }
    // Explicit no-cache query also avoids the short-lived presentation read cache.
    readTransport.invalidate();
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('id', id)
      .eq('vessel_id', vesselId)
      .maybeSingle();
    if (error) throw error;
    return data ? this.mapRow(data) : null;
  }
  async getByVessel(vesselId: string): Promise<InventoryItem[]> {
    if (offlineInventory.enabled()) return (await offlineInventory.list(vesselId)).map(this.mapRow);
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
      throw e;
    }
  }

  async getById(id: string): Promise<InventoryItem | null> {
    if (offlineInventory.enabled()) {
      const row = await offlineInventory.read(id);
      return row ? this.mapRow(row) : null;
    }
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
    if (offlineInventory.enabled()) return this.autoSave(crypto.randomUUID(), input, null);
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
    if (offlineInventory.enabled())
      throw new Error('Use Inventory Auto Save to preserve revision checks.');
    const payload: Record<string, unknown> = {};
    if (updates.title !== undefined) {
      const t = updates.title.trim();
      payload.title = t;
      if (t) payload.name = t;
    }
    if (updates.description !== undefined) payload.description = updates.description.trim();
    if (updates.location !== undefined) payload.location = updates.location.trim();
    if (updates.department !== undefined)
      payload.department = normalizeDepartment(updates.department);
    if (updates.items !== undefined) {
      payload.items = updates.items
        .filter((row) => row.amount.trim() || row.item.trim())
        .map((row) => ({ amount: row.amount.trim(), item: row.item.trim() }));
    }
    payload.last_edited_by_name = (updates.lastEditedByName ?? '').trim() || 'Unknown';
    payload.last_edited_at = new Date().toISOString();
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
    if (offlineInventory.enabled()) await offlineInventory.beforeDelete(id);
    const { data, error } = await supabase
      .from('inventory_items')
      .delete()
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Deleting the inventory item');
    if (offlineInventory.enabled()) await offlineInventory.refresh();
  }

  private mapRow(row: Record<string, unknown>): InventoryItem {
    return {
      offlineLocalVersion:
        typeof row.offlineLocalVersion === 'number' ? row.offlineLocalVersion : undefined,
      id: row.id as string,
      vesselId: row.vessel_id as string,
      department: row.department as Department,
      title: (row.title ?? row.name ?? '') as string,
      description: (row.description as string) || '',
      location: (row.location as string) || '',
      items: normalizeRows(row.items),
      createdAt: row.created_at as string,
      lastEditedAt: (row.last_edited_at as string | null) ?? null,
    };
  }
}

export default new InventoryService();
