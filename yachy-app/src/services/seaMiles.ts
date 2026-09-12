import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';
import type {
  CaptainSeaMileContact,
  SeaMileEntry,
  SeaMileEntryStatus,
  SeaMileFolder,
  SeaMileFolderAssignment,
} from '../types';

export interface SeaMileEntryFields {
  voyageDate: string;
  vesselName: string;
  vesselLength: string;
  fromLocation: string;
  toLocation: string;
  capacityRole: string;
  milesLogged: number;
  dayHours: number;
  nightHours: number;
  tidal: boolean;
}

export interface CaptainSeaMileContactFields {
  firstName: string;
  lastName: string;
  cellNumber: string | null;
  emailAddress: string | null;
}

const OWN_SELECT = '*';
const REVIEW_SELECT = '*';

function mapRow(row: any): SeaMileEntry {
  return {
    id: row.id,
    userId: row.user_id,
    reviewVesselId: row.review_vessel_id ?? null,
    voyageDate: row.voyage_date,
    vesselName: row.vessel_name,
    vesselLength: row.vessel_length,
    fromLocation: row.from_location,
    toLocation: row.to_location,
    capacityRole: row.capacity_role,
    milesLogged: Number(row.miles_logged),
    dayHours: Number(row.day_hours),
    nightHours: Number(row.night_hours),
    tidal: !!row.tidal,
    status: row.status as SeaMileEntryStatus,
    declineComment: row.decline_comment ?? null,
    submittedAt: row.submitted_at ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewerName: row.reviewer_name ?? null,
    reviewerSignatureType: row.reviewer_signature_type ?? null,
    reviewerSignatureImage: row.reviewer_signature_image ?? null,
    reviewerTypedName: row.reviewer_typed_name ?? null,
    reviewerContactFirstName: row.reviewer_contact_first_name ?? null,
    reviewerContactLastName: row.reviewer_contact_last_name ?? null,
    reviewerContactCellNumber: row.reviewer_contact_cell_number ?? null,
    reviewerContactEmailAddress: row.reviewer_contact_email_address ?? null,
    reviewedAt: row.reviewed_at ?? null,
    ownerName: row.owner_name ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCaptainContact(row: any): CaptainSeaMileContact {
  return {
    userId: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    cellNumber: row.cell_number ?? null,
    emailAddress: row.email_address ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFolder(row: any): SeaMileFolder {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(input: SeaMileEntryFields): Record<string, unknown> {
  return {
    voyage_date: input.voyageDate,
    vessel_name: input.vesselName.trim(),
    vessel_length: input.vesselLength.trim(),
    from_location: input.fromLocation.trim(),
    to_location: input.toLocation.trim(),
    capacity_role: input.capacityRole.trim(),
    miles_logged: input.milesLogged,
    day_hours: input.dayHours,
    night_hours: input.nightHours,
    tidal: input.tidal,
  };
}

class SeaMilesService {
  async getFolders(userId: string): Promise<SeaMileFolder[]> {
    const { data, error } = await supabase
      .from('sea_mile_folders')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapFolder);
  }

  async getFolderAssignments(): Promise<SeaMileFolderAssignment[]> {
    const { data, error } = await supabase
      .from('sea_mile_folder_items')
      .select('entry_id, folder_id');
    if (error) throw error;
    return (data ?? []).map((row) => ({ entryId: row.entry_id, folderId: row.folder_id }));
  }

  async createFolder(userId: string, name: string): Promise<SeaMileFolder> {
    const { data, error } = await supabase
      .from('sea_mile_folders')
      .insert({ user_id: userId, name: name.trim() })
      .select('*')
      .single();
    if (error) throw error;
    return mapFolder(data);
  }

  async renameFolder(id: string, name: string): Promise<void> {
    const { data, error } = await supabase
      .from('sea_mile_folders')
      .update({ name: name.trim() })
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Renaming sea-mile folder');
  }

  async deleteFolder(id: string): Promise<void> {
    const { data, error } = await supabase
      .from('sea_mile_folders')
      .delete()
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Deleting sea-mile folder');
  }

  async moveEntryToFolder(entryId: string, folderId: string | null): Promise<void> {
    if (!folderId) {
      const { error } = await supabase
        .from('sea_mile_folder_items')
        .delete()
        .eq('entry_id', entryId);
      if (error) throw error;
      return;
    }

    const { data, error } = await supabase
      .from('sea_mile_folder_items')
      .upsert({ entry_id: entryId, folder_id: folderId }, { onConflict: 'entry_id' })
      .select('entry_id');
    requireAffectedRows(data, error, 'Moving sea-mile entry');
  }

  async getCaptainContact(userId: string): Promise<CaptainSeaMileContact | null> {
    const { data, error } = await supabase
      .from('captain_sea_mile_contacts')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapCaptainContact(data) : null;
  }

  async saveCaptainContact(
    userId: string,
    input: CaptainSeaMileContactFields
  ): Promise<CaptainSeaMileContact> {
    const { data, error } = await supabase
      .from('captain_sea_mile_contacts')
      .upsert(
        {
          user_id: userId,
          first_name: input.firstName.trim(),
          last_name: input.lastName.trim(),
          cell_number: input.cellNumber?.trim() || null,
          email_address: input.emailAddress?.trim().toLowerCase() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select('*')
      .single();
    if (error) throw error;
    return mapCaptainContact(data);
  }

  async getOwn(userId: string): Promise<SeaMileEntry[]> {
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .select(OWN_SELECT)
      .eq('user_id', userId)
      .order('voyage_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  }

  async getById(id: string): Promise<SeaMileEntry | null> {
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .select(REVIEW_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data) : null;
  }

  async getPendingForVessel(vesselId: string): Promise<SeaMileEntry[]> {
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .select(REVIEW_SELECT)
      .eq('review_vessel_id', vesselId)
      .eq('status', 'PENDING')
      .order('submitted_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  }

  async createDraft(userId: string, input: SeaMileEntryFields): Promise<SeaMileEntry> {
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .insert({ user_id: userId, status: 'DRAFT', ...toRow(input) })
      .select(OWN_SELECT)
      .single();
    if (error) throw error;
    return mapRow(data);
  }

  async updateEditable(id: string, input: SeaMileEntryFields): Promise<void> {
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .update({ ...toRow(input), status: 'DRAFT' })
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Updating sea-mile entry');
  }

  async submit(id: string, input: SeaMileEntryFields): Promise<void> {
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .update({ ...toRow(input), status: 'PENDING' })
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Submitting sea-mile entry');
  }

  async updatePendingAsCaptain(id: string, input: SeaMileEntryFields): Promise<void> {
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .update(toRow(input))
      .eq('id', id)
      .eq('status', 'PENDING')
      .select('id');
    requireAffectedRows(data, error, 'Updating pending sea-mile entry');
  }

  async approve(id: string): Promise<void> {
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .update({ status: 'APPROVED' })
      .eq('id', id)
      .eq('status', 'PENDING')
      .select('id');
    requireAffectedRows(data, error, 'Approving sea-mile entry');
  }

  async decline(id: string, comment: string): Promise<void> {
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .update({ status: 'DECLINED', decline_comment: comment.trim() })
      .eq('id', id)
      .eq('status', 'PENDING')
      .select('id');
    requireAffectedRows(data, error, 'Declining sea-mile entry');
  }

  async deleteEditable(id: string): Promise<void> {
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .delete()
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Deleting sea-mile entry');
  }
}

export default new SeaMilesService();
