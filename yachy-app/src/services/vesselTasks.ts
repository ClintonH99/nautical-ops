/**
 * Vessel Tasks Service
 * Handles Daily, Weekly, Monthly tasks for a vessel
 */

import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';
import { VesselTask, TaskCategory, TaskRecurring, Department } from '../types';
import { toYYYYMMDD } from '../utils';
import {
  calculateRecurringTaskDueDate,
  isTaskRecurrenceAllowed,
  normalizeTaskRecurrence,
} from '../utils/taskRecurrence';

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
  category?: TaskCategory;
  title?: string;
  notes?: string;
  department?: Department;
  doneByDate?: string | null;
  status?: string;
  recurring?: TaskRecurring;
  completedBy?: string | null;
  completedAt?: string | null;
  completedByName?: string | null;
}

class VesselTasksService {
  async getByVesselAndCategory(vesselId: string, category: TaskCategory): Promise<VesselTask[]> {
    try {
      const { data, error } = await supabase
        .from('vessel_tasks')
        .select('*')
        .eq('vessel_id', vesselId)
        .eq('category', category)
        .neq('status', 'COMPLETED')
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
      const recurring = input.category === 'DAILY' ? null : input.recurring;
      if (
        input.category !== 'DAILY' &&
        !isTaskRecurrenceAllowed(input.category, recurring ?? null)
      ) {
        const allowed = input.category === 'WEEKLY' ? '7 or 14 days' : '14 or 30 days';
        throw new Error(
          `${input.category === 'WEEKLY' ? 'Weekly' : 'Monthly'} tasks must repeat every ${allowed}.`
        );
      }
      const doneByDate = recurring
        ? input.doneByDate || calculateRecurringTaskDueDate(recurring)
        : input.doneByDate || null;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('vessel_tasks')
        .insert([
          {
            vessel_id: input.vesselId,
            category: input.category,
            department: input.department,
            title: input.title.trim(),
            notes: input.notes?.trim() || null,
            done_by_date: doneByDate,
            recurring,
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
      if (input.category !== undefined) payload.category = input.category;
      if (input.title !== undefined) payload.title = input.title.trim();
      if (input.notes !== undefined) payload.notes = input.notes?.trim() || null;
      if (input.department !== undefined) payload.department = input.department;
      if (input.doneByDate !== undefined) payload.done_by_date = input.doneByDate || null;
      if (input.status !== undefined) payload.status = input.status;
      if (input.recurring !== undefined) payload.recurring = input.recurring || null;
      if (input.completedBy !== undefined) payload.completed_by = input.completedBy || null;
      if (input.completedAt !== undefined) payload.completed_at = input.completedAt || null;
      if (input.completedByName !== undefined)
        payload.completed_by_name = input.completedByName || null;

      const { data, error } = await supabase
        .from('vessel_tasks')
        .update(payload)
        .eq('id', taskId)
        .select('id');
      requireAffectedRows(data, error, 'Updating the task');
    } catch (error) {
      console.error('Update vessel task error:', error);
      throw error;
    }
  }

  async delete(taskId: string): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('vessel_tasks')
        .delete()
        .eq('id', taskId)
        .select('id');
      requireAffectedRows(data, error, 'Deleting the task');
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

    // Recurring: schedule from the completion date, then reset the same row for its next cycle.
    if (task.recurring) {
      const nextDue = calculateRecurringTaskDueDate(task.recurring, new Date());
      await this.update(taskId, {
        status: 'NOT_STARTED',
        doneByDate: nextDue,
        recurring: task.recurring,
        completedBy: null,
        completedAt: null,
        completedByName: null,
      });
      return {};
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

  async unmarkComplete(taskId: string): Promise<void> {
    const { data, error } = await supabase.rpc('unmark_vessel_task_complete', {
      target_task_id: taskId,
    });
    requireAffectedRows(data, error, 'Returning the task to the active list');
  }

  async getOverdueTasks(vesselId: string): Promise<VesselTask[]> {
    try {
      const today = toYYYYMMDD(new Date());
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
      const startDate = toYYYYMMDD(today);
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + withinDays);
      const endDateStr = toYYYYMMDD(endDate);

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
    const category = row.category as TaskCategory;
    const status = row.status as VesselTask['status'];
    const storedRecurring = (row.recurring as TaskRecurring) ?? null;
    const recurring =
      status === 'COMPLETED' ? storedRecurring : normalizeTaskRecurrence(category, storedRecurring);
    let doneByDate = (row.done_by_date as string) ?? null;

    if (status !== 'COMPLETED' && recurring && !doneByDate) {
      try {
        doneByDate = calculateRecurringTaskDueDate(recurring, row.created_at as string);
      } catch {
        doneByDate = calculateRecurringTaskDueDate(recurring);
      }
    }

    return {
      id: row.id as string,
      vesselId: row.vessel_id as string,
      category,
      department: (row.department as Department) ?? 'INTERIOR',
      title: row.title as string,
      notes: (row.notes as string) ?? '',
      doneByDate,
      status,
      recurring,
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
