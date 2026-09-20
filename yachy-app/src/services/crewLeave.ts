import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';
import type { CrewLeave, CrewLeaveType, Department } from '../types';
import { DEPARTMENT_OPTIONS } from '../utils/departmentSelection';
import { sortCrewLeave, type CrewLeaveStatusFilter } from '../utils/crewLeave';
import { toYYYYMMDD } from '../utils';

export interface CreateCrewLeaveData {
  vesselId: string;
  crewMemberId: string;
  leaveType: CrewLeaveType;
  startDate: string;
  endDate: string;
  notes?: string;
}

export interface UpdateCrewLeaveData {
  crewMemberId?: string;
  leaveType?: CrewLeaveType;
  startDate?: string;
  endDate?: string;
  notes?: string;
}

type CrewLeaveEvent = 'created' | 'updated';

const SELECT_WITH_CREW =
  '*, crew_member:users!crew_leave_crew_member_id_fkey(id, name, position, department, department_2)';

const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 50;

export interface CrewLeaveFilters {
  status?: CrewLeaveStatusFilter;
  leaveType?: CrewLeaveType;
  departments?: Department[];
  asOfDate?: string;
}

export interface CrewLeavePage {
  items: CrewLeave[];
  hasMore: boolean;
}

export interface CrewLeaveCalendarEntry {
  id: string;
  leaveType: CrewLeaveType;
  startDate: string;
  endDate: string;
}

function isDepartment(value: unknown): value is Department {
  return typeof value === 'string' && DEPARTMENT_OPTIONS.includes(value as Department);
}

function isMissingDepartmentSnapshot(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string };
  return (
    (candidate.code === '42703' || candidate.code === 'PGRST204') &&
    (candidate.message ?? '').includes('crew_member_departments_snapshot')
  );
}

class CrewLeaveService {
  private mapRow(row: any): CrewLeave {
    const crewMember = Array.isArray(row.crew_member) ? row.crew_member[0] : row.crew_member;
    const snapshotDepartments = Array.isArray(row.crew_member_departments_snapshot)
      ? row.crew_member_departments_snapshot.filter(isDepartment)
      : [];
    const liveDepartments = [crewMember?.department, crewMember?.department_2].filter(isDepartment);
    return {
      id: row.id,
      vesselId: row.vessel_id,
      crewMemberId: row.crew_member_id ?? null,
      crewMemberName: row.crew_member_name_snapshot ?? crewMember?.name ?? 'Former crew member',
      crewMemberPosition: row.crew_member_position_snapshot ?? crewMember?.position ?? undefined,
      crewMemberDepartments: snapshotDepartments.length > 0 ? snapshotDepartments : liveDepartments,
      leaveType: row.leave_type as CrewLeaveType,
      startDate: row.start_date,
      endDate: row.end_date,
      notes: row.notes ?? '',
      createdBy: row.created_by ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async notifyCrewMember(id: string, event: CrewLeaveEvent): Promise<void> {
    try {
      const { error } = await supabase.functions.invoke('send-trip-push', {
        body: { type: 'crew_leave', crewLeaveId: id, event },
      });
      if (error && __DEV__) console.warn('[Crew Leave] Notification could not be sent:', error);
    } catch (error) {
      // Saving leave must never fail because push delivery is temporarily unavailable.
      if (__DEV__) console.warn('[Crew Leave] Notification unavailable:', error);
    }
  }

  async getPage(
    vesselId: string,
    filters: CrewLeaveFilters = {},
    offset = 0,
    requestedPageSize = DEFAULT_PAGE_SIZE
  ): Promise<CrewLeavePage> {
    const status = filters.status ?? 'ACTIVE';
    const asOfDate = filters.asOfDate ?? toYYYYMMDD(new Date());
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(requestedPageSize)));
    const safeOffset = Math.max(0, Math.trunc(offset));

    const buildQuery = (includeDepartment: boolean) => {
      let query = supabase.from('crew_leave').select(SELECT_WITH_CREW).eq('vessel_id', vesselId);

      if (filters.leaveType) query = query.eq('leave_type', filters.leaveType);
      if (includeDepartment && filters.departments?.length) {
        query = query.overlaps('crew_member_departments_snapshot', filters.departments);
      }

      if (status === 'ACTIVE') {
        query = query.gte('end_date', asOfDate).order('start_date', { ascending: true });
      } else if (status === 'CURRENT') {
        query = query
          .lte('start_date', asOfDate)
          .gte('end_date', asOfDate)
          .order('end_date', { ascending: true });
      } else if (status === 'UPCOMING') {
        query = query.gt('start_date', asOfDate).order('start_date', { ascending: true });
      } else if (status === 'COMPLETED') {
        query = query.lt('end_date', asOfDate).order('end_date', { ascending: false });
      } else {
        query = query.order('start_date', { ascending: false });
      }

      return query.order('id', { ascending: false });
    };

    const response = await buildQuery(true).range(safeOffset, safeOffset + pageSize);
    if (
      response.error &&
      filters.departments?.length &&
      isMissingDepartmentSnapshot(response.error)
    ) {
      // Keep department filtering available while the history migration is
      // rolled out. Once the snapshot exists, the server-side query above is
      // authoritative and this compatibility path is no longer used.
      const legacyResponse = await buildQuery(false);
      if (legacyResponse.error) throw legacyResponse.error;
      const matching = sortCrewLeave(
        (legacyResponse.data ?? [])
          .map((row) => this.mapRow(row))
          .filter((item) =>
            item.crewMemberDepartments.some((department) =>
              filters.departments?.includes(department)
            )
          ),
        asOfDate
      );
      return {
        items: matching.slice(safeOffset, safeOffset + pageSize),
        hasMore: matching.length > safeOffset + pageSize,
      };
    }
    if (response.error) throw response.error;
    const rows = response.data ?? [];
    return {
      items: sortCrewLeave(
        rows.slice(0, pageSize).map((row) => this.mapRow(row)),
        asOfDate
      ),
      hasMore: rows.length > pageSize,
    };
  }

  async getCalendarInRange(
    vesselId: string,
    windowStart: string,
    windowEnd: string
  ): Promise<CrewLeaveCalendarEntry[]> {
    const { data, error } = await supabase
      .from('crew_leave')
      .select('id, leave_type, start_date, end_date')
      .eq('vessel_id', vesselId)
      .lte('start_date', windowEnd)
      .gte('end_date', windowStart)
      .order('start_date', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      leaveType: row.leave_type as CrewLeaveType,
      startDate: row.start_date,
      endDate: row.end_date,
    }));
  }

  async getById(id: string): Promise<CrewLeave | null> {
    const { data, error } = await supabase
      .from('crew_leave')
      .select(SELECT_WITH_CREW)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? this.mapRow(data) : null;
  }

  async create(input: CreateCrewLeaveData): Promise<CrewLeave> {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) throw new Error('You must be signed in to publish crew leave.');

    const { data, error } = await supabase
      .from('crew_leave')
      .insert({
        vessel_id: input.vesselId,
        crew_member_id: input.crewMemberId,
        leave_type: input.leaveType,
        start_date: input.startDate,
        end_date: input.endDate,
        notes: input.notes?.trim() || '',
        created_by: authData.user.id,
      })
      .select(SELECT_WITH_CREW)
      .single();
    if (error) throw error;

    const created = this.mapRow(data);
    void this.notifyCrewMember(created.id, 'created');
    return created;
  }

  async update(id: string, input: UpdateCrewLeaveData): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (input.crewMemberId !== undefined) patch.crew_member_id = input.crewMemberId;
    if (input.leaveType !== undefined) patch.leave_type = input.leaveType;
    if (input.startDate !== undefined) patch.start_date = input.startDate;
    if (input.endDate !== undefined) patch.end_date = input.endDate;
    if (input.notes !== undefined) patch.notes = input.notes.trim();

    const { data, error } = await supabase
      .from('crew_leave')
      .update(patch)
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Updating crew leave');
    void this.notifyCrewMember(id, 'updated');
  }

  async delete(id: string): Promise<void> {
    const { data, error } = await supabase.from('crew_leave').delete().eq('id', id).select('id');
    requireAffectedRows(data, error, 'Deleting crew leave');
  }
}

export default new CrewLeaveService();
