/**
 * Vessel Tasks Service
 * Handles Daily, Weekly, Monthly tasks for a vessel
 */

import { supabase } from './supabase';
import { VesselTask, TaskCategory, TaskRecurring, Department } from '../types';

export interface CreateVesselTaskData {
  vesselId: string;
  category: TaskCategory;
  department: Department;
  title: string;
  notes?: string;
  doneByDate?: string | null;
  recurring?: TaskRecurring;
}

export interface UpdateVesselTaskData {
  title?: string;
  notes?: string;
  department?: Department;
  doneByDate?: string | null;
  status?: string;
  recurring?: TaskRecurring;
  completedBy?: string;
  completedAt?: string;
  completedByName?: string;
}

class VesselTasksService {
  async getByVesselAndCategory(
    vesselId: string,
    category: TaskCategory
  ): Promise<VesselTask[]> {
    try {
      const { data, error } = await supabase
        .from('vessel_tasks')
        .select('*')
        .eq('vessel_id', vesselId)
        .eq('category', category)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(this.mapRowToTask);
    } catch (error) {
      console.error('Get vessel tasks error:', error);
      return [];
    }
  }

  async create(input: CreateVesselTaskData): Promise<VesselTask> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('vessel_tasks')
        .insert([
          {
            vessel_id: input.vesselId,
            category: input.category,
            department: input.department,
            title: input.title.trim(),
            notes: input.notes?.trim() || null,
            done_by_date: input.doneByDate || null,
            recurring: input.recurring || null,
            status: 'NOT_STARTED',
            created_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) throw error;
      return this.mapRowToTask(data);
    } catch (err) {
      console.error('Create vessel task error:', err);
      throw err;
    }
  }

  async update(taskId: string, input: UpdateVesselTaskData): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (input.title !== undefined) payload.title = input.title.trim();
      if (input.notes !== undefined) payload.notes = input.notes?.trim() || null;
      if (input.department !== undefined) payload.department = input.department;
      if (input.doneByDate !== undefined) payload.done_by_date = input.doneByDate || null;
      if (input.status !== undefined) payload.status = input.status;
      if (input.recurring !== undefined) payload.recurring = input.recurring || null;
      if (input.completedBy !== undefined) payload.completed_by = input.completedBy || null;
      if (input.completedAt !== undefined) payload.completed_at = input.completedAt || null;
      if (input.completedByName !== undefined) payload.completed_by_name = input.completedByName || null;

      const { error } = await supabase
        .from('vessel_tasks')
        .update(payload)
        .eq('id', taskId);

      if (error) throw error;
    } catch (error) {
      console.error('Update vessel task error:', error);
      throw error;
    }
  }

  async delete(taskId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('vessel_tasks')
        .delete()
        .eq('id', taskId);

      if (error) throw error;
    } catch (error) {
      console.error('Delete vessel task error:', error);
      throw error;
    }
  }

  async markComplete(
    taskId: string,
    completedBy: string,
    completedByName: string
  ): Promise<{ createdNext?: VesselTask }> {
    const task = await this.getById(taskId);
    if (!task) throw new Error('Task not found');

    // Recurring tasks: create next occurrence and delete the completed one (don't keep it populated)
    if (task.recurring && task.doneByDate) {
      const days = task.recurring === '7_DAYS' ? 7 : task.recurring === '14_DAYS' ? 14 : 30;
      const nextDate = new Date(task.doneByDate);
      nextDate.setDate(nextDate.getDate() + days);
      const next = await this.create({
        vesselId: task.vesselId,
        category: task.category,
        department: task.department,
        title: task.title,
        notes: task.notes || undefined,
        doneByDate: nextDate.toISOString().slice(0, 10),
        recurring: task.recurring,
      });
      await this.delete(taskId);
      return { createdNext: next };
    }

    // Non-recurring: mark as completed
    const completedAt = new Date().toISOString();
    await this.update(taskId, {
      status: 'COMPLETED',
      completedBy,
      completedAt,
      completedByName,
    });
    return {};
  }

  async getOverdueTasks(vesselId: string): Promise<VesselTask[]> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('vessel_tasks')
        .select('*')
        .eq('vessel_id', vesselId)
        .not('done_by_date', 'is', null)
        .lt('done_by_date', today)
        .neq('status', 'COMPLETED')
        .order('done_by_date', { ascending: true });

      if (error) throw error;
      return (data || []).map(this.mapRowToTask);
    } catch (error) {
      console.error('Get overdue tasks error:', error);
      return [];
    }
  }

  /**
   * Tasks from Daily, Weekly, Monthly that are due within the next N days (not overdue, not completed).
   */
  /**
   * Get all tasks (any category, any status) with done_by_date in the given date range.
   * Used for Tasks Calendar.
   */
  async getTasksInDateRange(
    vesselId: string,
    startDate: string,
    endDate: string
  ): Promise<VesselTask[]> {
    try {
      const { data, error } = await supabase
        .from('vessel_tasks')
        .select('*')
        .eq('vessel_id', vesselId)
        .not('done_by_date', 'is', null)
        .gte('done_by_date', startDate)
        .lte('done_by_date', endDate)
        .order('done_by_date', { ascending: true });

      if (error) throw error;
      return (data || []).map(this.mapRowToTask);
    } catch (error) {
      console.error('Get tasks in date range error:', error);
      return [];
    }
  }

  async getCompletedTasks(vesselId: string): Promise<VesselTask[]> {
    try {
      const { data, error } = await supabase
        .from('vessel_tasks')
        .select('*')
        .eq('vessel_id', vesselId)
        .eq('status', 'COMPLETED')
        .order('completed_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(this.mapRowToTask);
    } catch (error) {
      console.error('Get completed tasks error:', error);
      return [];
    }
  }

  async getUpcomingTasks(vesselId: string, withinDays: number = 3): Promise<VesselTask[]> {
    try {
      const today = new Date();
      const startDate = today.toISOString().slice(0, 10);
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + withinDays);
      const endDateStr = endDate.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('vessel_tasks')
        .select('*')
        .eq('vessel_id', vesselId)
        .not('done_by_date', 'is', null)
        .gte('done_by_date', startDate)
        .lte('done_by_date', endDateStr)
        .neq('status', 'COMPLETED')
        .in('category', ['DAILY', 'WEEKLY', 'MONTHLY'])
        .order('done_by_date', { ascending: true });

      if (error) throw error;
      return (data || []).map(this.mapRowToTask);
    } catch (error) {
      console.error('Get upcoming tasks error:', error);
      return [];
    }
  }

  async deleteCompletedTasksBefore(vesselId: string, beforeDate: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('vessel_tasks')
        .delete()
        .eq('vessel_id', vesselId)
        .eq('status', 'COMPLETED')
        .lt('completed_at', beforeDate)
        .select('id');

      if (error) throw error;
      return (data || []).length;
    } catch (error) {
      console.error('Delete completed tasks error:', error);
      return 0;
    }
  }

  async getById(taskId: string): Promise<VesselTask | null> {
    try {
      const { data, error } = await supabase
        .from('vessel_tasks')
        .select('*')
        .eq('id', taskId)
        .single();

      if (error) throw error;
      return data ? this.mapRowToTask(data) : null;
    } catch (error) {
      console.error('Get vessel task error:', error);
      return null;
    }
  }

  private mapRowToTask(row: Record<string, unknown>): VesselTask {
    return {
      id: row.id as string,
      vesselId: row.vessel_id as string,
      category: row.category as TaskCategory,
      department: (row.department as Department) ?? 'INTERIOR',
      title: row.title as string,
      notes: (row.notes as string) ?? '',
      doneByDate: (row.done_by_date as string) ?? null,
      status: (row.status as string) as VesselTask['status'],
      recurring: (row.recurring as TaskRecurring) ?? null,
      completedBy: row.completed_by as string | undefined,
      completedAt: row.completed_at as string | undefined,
      completedByName: row.completed_by_name as string | undefined,
      createdBy: row.created_by as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}

export default new VesselTasksService();
