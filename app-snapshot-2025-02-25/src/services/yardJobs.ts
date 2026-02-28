/**
 * Yard Period Jobs Service
 */

import { supabase } from './supabase';
import { YardPeriodJob, Department, YardJobPriority } from '../types';

export interface CreateYardJobData {
  vesselId: string;
  jobTitle: string;
  jobDescription?: string;
  department: Department;
  priority: YardJobPriority;
  yardLocation?: string;
  contractorCompanyName?: string;
  contactDetails?: string;
  doneByDate?: string | null;
}

export interface UpdateYardJobData {
  jobTitle?: string;
  jobDescription?: string;
  department?: Department;
  priority?: YardJobPriority;
  yardLocation?: string;
  contractorCompanyName?: string;
  contactDetails?: string;
  doneByDate?: string | null;
  status?: string;
  completedBy?: string;
  completedAt?: string;
  completedByName?: string;
}

class YardJobsService {
  async getByVessel(vesselId: string): Promise<YardPeriodJob[]> {
    try {
      const { data, error } = await supabase
        .from('yard_period_jobs')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(this.mapRowToJob);
    } catch (error) {
      console.error('Get yard jobs error:', error);
      return [];
    }
  }

  async create(input: CreateYardJobData): Promise<YardPeriodJob> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('yard_period_jobs')
        .insert([
          {
            vessel_id: input.vesselId,
            job_title: input.jobTitle.trim(),
            job_description: input.jobDescription?.trim() || null,
            department: input.department,
            priority: input.priority,
            yard_location: input.yardLocation?.trim() || null,
            contractor_company_name: input.contractorCompanyName?.trim() || null,
            contact_details: input.contactDetails?.trim() || null,
            done_by_date: input.doneByDate || null,
            status: 'NOT_STARTED',
            created_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) throw error;
      return this.mapRowToJob(data);
    } catch (error) {
      console.error('Create yard job error:', error);
      throw error;
    }
  }

  async update(jobId: string, input: UpdateYardJobData): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (input.jobTitle !== undefined) payload.job_title = input.jobTitle.trim();
      if (input.jobDescription !== undefined) payload.job_description = input.jobDescription?.trim() || null;
      if (input.department !== undefined) payload.department = input.department;
      if (input.priority !== undefined) payload.priority = input.priority;
      if (input.yardLocation !== undefined) payload.yard_location = input.yardLocation?.trim() || null;
      if (input.contractorCompanyName !== undefined) payload.contractor_company_name = input.contractorCompanyName?.trim() || null;
      if (input.contactDetails !== undefined) payload.contact_details = input.contactDetails?.trim() || null;
      if (input.doneByDate !== undefined) payload.done_by_date = input.doneByDate || null;
      if (input.status !== undefined) payload.status = input.status;
      if (input.completedBy !== undefined) payload.completed_by = input.completedBy || null;
      if (input.completedAt !== undefined) payload.completed_at = input.completedAt || null;
      if (input.completedByName !== undefined) payload.completed_by_name = input.completedByName || null;

      const { error } = await supabase
        .from('yard_period_jobs')
        .update(payload)
        .eq('id', jobId);

      if (error) throw error;
    } catch (error) {
      console.error('Update yard job error:', error);
      throw error;
    }
  }

  async delete(jobId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('yard_period_jobs')
        .delete()
        .eq('id', jobId);

      if (error) throw error;
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
      return data ? this.mapRowToJob(data) : null;
    } catch (error) {
      console.error('Get yard job error:', error);
      return null;
    }
  }

  async markComplete(
    jobId: string,
    completedBy: string,
    completedByName: string
  ): Promise<void> {
    const completedAt = new Date().toISOString();
    await this.update(jobId, {
      status: 'COMPLETED',
      completedBy,
      completedAt,
      completedByName,
    });
  }

  private mapRowToJob(row: Record<string, unknown>): YardPeriodJob {
    return {
      id: row.id as string,
      vesselId: row.vessel_id as string,
      jobTitle: row.job_title as string,
      jobDescription: (row.job_description as string) ?? '',
      department: (row.department as Department) ?? 'INTERIOR',
      priority: (row.priority as YardJobPriority) ?? 'GREEN',
      yardLocation: (row.yard_location as string) ?? '',
      contractorCompanyName: (row.contractor_company_name as string) ?? '',
      contactDetails: (row.contact_details as string) ?? '',
      doneByDate: (row.done_by_date as string) ?? null,
      status: (row.status as string) as YardPeriodJob['status'],
      completedBy: row.completed_by as string | undefined,
      completedAt: row.completed_at as string | undefined,
      completedByName: row.completed_by_name as string | undefined,
      createdBy: row.created_by as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}

export default new YardJobsService();
