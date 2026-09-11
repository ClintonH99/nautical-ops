import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';
import type { CrewLeave, CrewLeaveType, Department } from '../types';

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
  '*, crew_member:users!crew_leave_crew_member_id_fkey(id, name, position, department)';

class CrewLeaveService {
  private mapRow(row: any): CrewLeave {
    const crewMember = Array.isArray(row.crew_member) ? row.crew_member[0] : row.crew_member;
    return {
      id: row.id,
      vesselId: row.vessel_id,
      crewMemberId: row.crew_member_id,
      crewMemberName: crewMember?.name ?? 'Crew member',
      crewMemberPosition: crewMember?.position ?? undefined,
      crewMemberDepartment: (crewMember?.department as Department | undefined) ?? undefined,
      leaveType: row.leave_type as CrewLeaveType,
      startDate: row.start_date,
      endDate: row.end_date,
      notes: row.notes ?? '',
      createdBy: row.created_by,
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

  async getByVessel(vesselId: string): Promise<CrewLeave[]> {
    const { data, error } = await supabase
      .from('crew_leave')
      .select(SELECT_WITH_CREW)
      .eq('vessel_id', vesselId)
      .order('start_date', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => this.mapRow(row));
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
