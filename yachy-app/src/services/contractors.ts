/**
 * Contractors Service
 */

import { supabase } from './supabase';
import { Department } from '../types';

export interface ContractorContact {
  name: string;
  mobile: string;
  email: string;
}

export interface Contractor {
  id: string;
  vesselId: string;
  department: Department;
  companyName: string;
  companyAddress: string;
  knownFor: string;
  description: string;
  contacts: ContractorContact[];
  createdAt: string;
  createdBy?: string;
}

export interface CreateContractorInput {
  vesselId: string;
  department: Department;
  companyName: string;
  companyAddress: string;
  knownFor: string;
  description: string;
  contacts: ContractorContact[];
  createdBy?: string;
}

function normalizeContacts(raw: unknown): ContractorContact[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (entry && typeof entry === 'object') {
      const o = entry as Record<string, unknown>;
      return {
        name: String(o.name ?? ''),
        mobile: String(o.mobile ?? ''),
        email: String(o.email ?? ''),
      };
    }
    return { name: '', mobile: '', email: '' };
  });
}

class ContractorsService {
  async getByVessel(vesselId: string): Promise<Contractor[]> {
    try {
      const { data, error } = await supabase
        .from('contractors')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('company_name', { ascending: true });

      if (error) throw error;
      return (data || []).map(this.mapRow);
    } catch (e) {
      console.error('Get contractors error:', e);
      return [];
    }
  }

  async create(input: CreateContractorInput): Promise<Contractor> {
    const contacts = input.contacts
      .filter((c) => c.name.trim() || c.mobile.trim() || c.email.trim())
      .map((c) => ({ name: c.name.trim(), mobile: c.mobile.trim(), email: c.email.trim() }));

    const { data, error } = await supabase
      .from('contractors')
      .insert([
        {
          vessel_id: input.vesselId,
          department: input.department,
          company_name: input.companyName.trim(),
          company_address: input.companyAddress.trim() || null,
          known_for: input.knownFor.trim() || null,
          description: input.description.trim() || null,
          contacts,
          created_by: input.createdBy || null,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(data);
  }

  async update(
    id: string,
    updates: {
      department?: Department;
      companyName?: string;
      companyAddress?: string;
      knownFor?: string;
      description?: string;
      contacts?: ContractorContact[];
    }
  ): Promise<Contractor> {
    const payload: Record<string, unknown> = {};
    if (updates.department !== undefined) payload.department = updates.department;
    if (updates.companyName !== undefined) payload.company_name = updates.companyName.trim();
    if (updates.companyAddress !== undefined)
      payload.company_address = updates.companyAddress.trim() || null;
    if (updates.knownFor !== undefined) payload.known_for = updates.knownFor.trim() || null;
    if (updates.description !== undefined) payload.description = updates.description.trim() || null;
    if (updates.contacts !== undefined) {
      payload.contacts = updates.contacts
        .filter((c) => c.name.trim() || c.mobile.trim() || c.email.trim())
        .map((c) => ({ name: c.name.trim(), mobile: c.mobile.trim(), email: c.email.trim() }));
    }

    const { data, error } = await supabase
      .from('contractors')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('contractors').delete().eq('id', id);
    if (error) throw error;
  }

  private mapRow(row: Record<string, unknown>): Contractor {
    const dept = row.department as string;
    return {
      id: row.id as string,
      vesselId: row.vessel_id as string,
      department: (['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'].includes(dept) ? dept : 'INTERIOR') as Department,
      companyName: row.company_name as string,
      companyAddress: (row.company_address as string) ?? '',
      knownFor: (row.known_for as string) ?? '',
      description: (row.description as string) ?? '',
      contacts: normalizeContacts(row.contacts),
      createdAt: row.created_at as string,
      createdBy: row.created_by as string | undefined,
    };
  }
}

export default new ContractorsService();
