/**
 * Yard Period Jobs Service
 */

import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';
import {
  YardPeriodJob,
  Department,
  YardJobPriority,
  ShipyardRecordFolder,
  ShipyardRecordFolderAssignment,
} from '../types';

export interface CreateYardJobData {
  vesselId: string;
  tripId?: string | null;
  jobTitle: string;
  jobDescription?: string;
  defectDetails?: string;
  defectLocation?: string;
  equipmentSerial?: string;
  department: Department;
  priority: YardJobPriority;
  yardLocation?: string;
  contractorCompanyName?: string;
  contactDetails?: string;
  startDate: string;
  endDate: string;
}

export interface UpdateYardJobData {
  jobTitle?: string;
  jobDescription?: string;
  defectDetails?: string;
  defectLocation?: string;
  equipmentSerial?: string;
  department?: Department;
  priority?: YardJobPriority;
  yardLocation?: string;
  contractorCompanyName?: string;
  contactDetails?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  completedBy?: string;
  completedAt?: string;
  completedByName?: string;
}

export function validateYardJobDateRange(startDate: string, endDate: string): void {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDate.test(startDate) || !isoDate.test(endDate)) {
    throw new Error('Shipyard job dates must use YYYY-MM-DD format.');
  }
  if (endDate < startDate) {
    throw new Error('The shipyard job end date cannot be before its start date.');
  }
}

export function mapRowToYardJob(row: Record<string, unknown>): YardPeriodJob {
  const legacyDate = (row.done_by_date as string) ?? null;
  return {
    id: row.id as string,
    vesselId: row.vessel_id as string,
    tripId: (row.trip_id as string) ?? null,
    jobTitle: row.job_title as string,
    jobDescription: (row.job_description as string) ?? '',
    defectDetails: (row.defect_details as string) ?? '',
    defectLocation: (row.defect_location as string) ?? '',
    equipmentSerial: (row.equipment_serial as string) ?? '',
    department: (row.department as Department) ?? 'INTERIOR',
    priority: (row.priority as YardJobPriority) ?? 'GREEN',
    yardLocation: (row.yard_location as string) ?? '',
    contractorCompanyName: (row.contractor_company_name as string) ?? '',
    contactDetails: (row.contact_details as string) ?? '',
    startDate: (row.start_date as string) ?? legacyDate,
    endDate: (row.end_date as string) ?? legacyDate,
    doneByDate: legacyDate,
    status: row.status as string as YardPeriodJob['status'],
    completedBy: row.completed_by as string | undefined,
    completedAt: row.completed_at as string | undefined,
    completedByName: row.completed_by_name as string | undefined,
    createdBy: row.created_by as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapRowToRecordFolder(row: Record<string, unknown>): ShipyardRecordFolder {
  return {
    id: row.id as string,
    vesselId: row.vessel_id as string,
    name: row.name as string,
    createdBy: row.created_by as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

class YardJobsService {
  async getRecordFolders(vesselId: string): Promise<ShipyardRecordFolder[]> {
    const { data, error } = await supabase
      .from('shipyard_record_folders')
      .select('*')
      .eq('vessel_id', vesselId)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapRowToRecordFolder);
  }

  async getRecordFolderAssignments(): Promise<ShipyardRecordFolderAssignment[]> {
    const { data, error } = await supabase
      .from('shipyard_record_folder_items')
      .select('job_id, folder_id');
    if (error) throw error;
    return (data ?? []).map((row) => ({ jobId: row.job_id, folderId: row.folder_id }));
  }

  async createRecordFolder(vesselId: string, name: string): Promise<ShipyardRecordFolder> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('shipyard_record_folders')
      .insert({
        vessel_id: vesselId,
        name: name.trim(),
        created_by: user?.id ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapRowToRecordFolder(data);
  }

  async renameRecordFolder(folderId: string, name: string): Promise<void> {
    const { data, error } = await supabase
      .from('shipyard_record_folders')
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', folderId)
      .select('id');
    requireAffectedRows(data, error, 'Renaming the Shipyard Records folder');
  }

  async deleteRecordFolder(folderId: string): Promise<void> {
    const { data, error } = await supabase
      .from('shipyard_record_folders')
      .delete()
      .eq('id', folderId)
      .select('id');
    requireAffectedRows(data, error, 'Deleting the Shipyard Records folder');
  }

  async moveRecordToFolder(jobId: string, folderId: string | null): Promise<void> {
    if (!folderId) {
      const { error } = await supabase
        .from('shipyard_record_folder_items')
        .delete()
        .eq('job_id', jobId);
      if (error) throw error;
      return;
    }

    const { data, error } = await supabase
      .from('shipyard_record_folder_items')
      .upsert({ job_id: jobId, folder_id: folderId }, { onConflict: 'job_id' })
      .select('job_id');
    requireAffectedRows(data, error, 'Moving the Shipyard Record');
  }

  async getByVessel(vesselId: string): Promise<YardPeriodJob[]> {
    try {
      const { data, error } = await supabase
        .from('yard_period_jobs')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(mapRowToYardJob);
    } catch (error) {
      console.error('Get yard jobs error:', error);
      throw error;
    }
  }

  async getByTrip(tripId: string): Promise<YardPeriodJob[]> {
    try {
      const { data, error } = await supabase
        .from('yard_period_jobs')
        .select('*')
        .eq('trip_id', tripId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(mapRowToYardJob);
    } catch (error) {
      console.error('Get yard jobs by trip error:', error);
      return [];
    }
  }

  async create(input: CreateYardJobData): Promise<YardPeriodJob> {
    try {
      validateYardJobDateRange(input.startDate, input.endDate);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('yard_period_jobs')
        .insert([
          {
            vessel_id: input.vesselId,
            trip_id: input.tripId ?? null,
            job_title: input.jobTitle.trim(),
            job_description: input.jobDescription?.trim() || null,
            defect_details: input.defectDetails?.trim() || null,
            defect_location: input.defectLocation?.trim() || null,
            equipment_serial: input.equipmentSerial?.trim() || null,
            department: input.department,
            priority: input.priority,
            yard_location: input.yardLocation?.trim() || null,
            contractor_company_name: input.contractorCompanyName?.trim() || null,
            contact_details: input.contactDetails?.trim() || null,
            start_date: input.startDate,
            end_date: input.endDate,
            status: 'NOT_STARTED',
            created_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) throw error;
      return mapRowToYardJob(data);
    } catch (error) {
      console.error('Create yard job error:', error);
      throw error;
    }
  }

  async update(jobId: string, input: UpdateYardJobData): Promise<void> {
    try {
      if (input.startDate !== undefined && input.endDate !== undefined) {
        validateYardJobDateRange(input.startDate, input.endDate);
      }
      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (input.jobTitle !== undefined) payload.job_title = input.jobTitle.trim();
      if (input.jobDescription !== undefined)
        payload.job_description = input.jobDescription?.trim() || null;
      if (input.defectDetails !== undefined)
        payload.defect_details = input.defectDetails?.trim() || null;
      if (input.defectLocation !== undefined)
        payload.defect_location = input.defectLocation?.trim() || null;
      if (input.equipmentSerial !== undefined)
        payload.equipment_serial = input.equipmentSerial?.trim() || null;
      if (input.department !== undefined) payload.department = input.department;
      if (input.priority !== undefined) payload.priority = input.priority;
      if (input.yardLocation !== undefined)
        payload.yard_location = input.yardLocation?.trim() || null;
      if (input.contractorCompanyName !== undefined)
        payload.contractor_company_name = input.contractorCompanyName?.trim() || null;
      if (input.contactDetails !== undefined)
        payload.contact_details = input.contactDetails?.trim() || null;
      if (input.startDate !== undefined) payload.start_date = input.startDate;
      if (input.endDate !== undefined) payload.end_date = input.endDate;
      if (input.status !== undefined) payload.status = input.status;
      if (input.completedBy !== undefined) payload.completed_by = input.completedBy || null;
      if (input.completedAt !== undefined) payload.completed_at = input.completedAt || null;
      if (input.completedByName !== undefined)
        payload.completed_by_name = input.completedByName || null;

      const { data, error } = await supabase
        .from('yard_period_jobs')
        .update(payload)
        .eq('id', jobId)
        .select('id');
      requireAffectedRows(data, error, 'Updating the shipyard job');
    } catch (error) {
      console.error('Update yard job error:', error);
      throw error;
    }
  }

  async delete(jobId: string): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('yard_period_jobs')
        .delete()
        .eq('id', jobId)
        .select('id');
      requireAffectedRows(data, error, 'Deleting the shipyard job');
    } catch (error) {
      console.error('Delete yard job error:', error);
      throw error;
    }
  }

  async getById(jobId: string): Promise<YardPeriodJob | null> {
    try {
      const { data, error } = await supabase
        .from('yard_period_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (error) throw error;
      return data ? mapRowToYardJob(data) : null;
    } catch (error) {
      console.error('Get yard job error:', error);
      return null;
    }
  }

  async markComplete(jobId: string, completedBy: string, completedByName: string): Promise<void> {
    const completedAt = new Date().toISOString();
    await this.update(jobId, {
      status: 'COMPLETED',
      completedBy,
      completedAt,
      completedByName,
    });
  }

  async unmarkComplete(jobId: string): Promise<void> {
    const { data, error } = await supabase.rpc('unmark_yard_job_complete', {
      target_job_id: jobId,
    });
    requireAffectedRows(data, error, 'Returning the Shipyard Record to Active Jobs');
  }
}

export default new YardJobsService();
