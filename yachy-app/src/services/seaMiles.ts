import { offlineSeaMiles } from '../offline/seaMilesService';
import type { RecordValue } from '../offline/outbox';
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
    offlineLocalVersion: row.offlineLocalVersion,
    offlinePending: row.offlinePending,
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

function toRow(input: SeaMileEntryFields): RecordValue {
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
  offlineEnabled = offlineSeaMiles.enabled;
  subscribe = offlineSeaMiles.subscribe;
  async hasApprovalSignature(userId: string): Promise<boolean> {
    if (offlineSeaMiles.enabled()) return (await offlineSeaMiles.context()).hasSignature === true;
    const { getSignatureForUser } = await import('./signatures');
    return !!(await getSignatureForUser(userId));
  }
  async createSubmitted(userId: string, input: SeaMileEntryFields): Promise<void> {
    if (offlineSeaMiles.enabled()) {
      await offlineSeaMiles.create({ user_id: userId, status: 'PENDING', ...toRow(input) });
      return;
    }
    const row = await this.createDraft(userId, input);
    await this.submit(row.id, input);
  }

  async getFolders(userId: string): Promise<SeaMileFolder[]> {
    if (offlineSeaMiles.enabled())
      return ((await offlineSeaMiles.context()).folders as RecordValue[])
        .filter((f) => f.user_id === userId)
        .map(mapFolder);
    const { data, error } = await supabase
      .from('sea_mile_folders')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapFolder);
  }

  async getFolderAssignments(): Promise<SeaMileFolderAssignment[]> {
    if (offlineSeaMiles.enabled())
      return ((await offlineSeaMiles.context()).assignments as RecordValue[]).map((i) => ({
        entryId: String(i.entry_id),
        folderId: String(i.folder_id),
      }));
    const { data, error } = await supabase
      .from('sea_mile_folder_items')
      .select('entry_id, folder_id');
    if (error) throw error;
    return (data ?? []).map((row) => ({ entryId: row.entry_id, folderId: row.folder_id }));
  }

  async createFolder(userId: string, name: string): Promise<SeaMileFolder> {
    if (offlineSeaMiles.enabled()) await offlineSeaMiles.beforeOnline();
    const { data, error } = await supabase
      .from('sea_mile_folders')
      .insert({ user_id: userId, name: name.trim() })
      .select('*')
      .single();
    if (error) throw error;
    if (offlineSeaMiles.enabled()) await offlineSeaMiles.refresh();
    return mapFolder(data);
  }

  async renameFolder(id: string, name: string): Promise<void> {
    if (offlineSeaMiles.enabled()) await offlineSeaMiles.beforeOnline();
    const { data, error } = await supabase
      .from('sea_mile_folders')
      .update({ name: name.trim() })
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Renaming sea-mile folder');
    if (offlineSeaMiles.enabled()) await offlineSeaMiles.refresh();
  }

  async deleteFolder(id: string): Promise<void> {
    if (offlineSeaMiles.enabled()) await offlineSeaMiles.beforeOnline();
    const { data, error } = await supabase
      .from('sea_mile_folders')
      .delete()
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Deleting sea-mile folder');
    if (offlineSeaMiles.enabled()) await offlineSeaMiles.refresh();
  }

  async moveEntryToFolder(entryId: string, folderId: string | null): Promise<void> {
    if (offlineSeaMiles.enabled()) await offlineSeaMiles.beforeOnline();
    if (!folderId) {
      const { error } = await supabase
        .from('sea_mile_folder_items')
        .delete()
        .eq('entry_id', entryId);
      if (error) throw error;
      if (offlineSeaMiles.enabled()) await offlineSeaMiles.refresh();
      return;
    }

    const { data, error } = await supabase
      .from('sea_mile_folder_items')
      .upsert({ entry_id: entryId, folder_id: folderId }, { onConflict: 'entry_id' })
      .select('entry_id');
    requireAffectedRows(data, error, 'Moving sea-mile entry');
    if (offlineSeaMiles.enabled()) await offlineSeaMiles.refresh();
  }

  async getCaptainContact(userId: string): Promise<CaptainSeaMileContact | null> {
    if (offlineSeaMiles.enabled()) {
      const c = (await offlineSeaMiles.context()).contact as RecordValue | null;
      return c?.user_id === userId ? mapCaptainContact(c) : null;
    }
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
    if (offlineSeaMiles.enabled()) await offlineSeaMiles.beforeOnline();
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
    if (offlineSeaMiles.enabled()) await offlineSeaMiles.refresh();
    return mapCaptainContact(data);
  }

  async getOwn(userId: string): Promise<SeaMileEntry[]> {
    if (offlineSeaMiles.enabled())
      return (await offlineSeaMiles.list())
        .filter((r) => r.user_id === userId)
        .map(mapRow)
        .sort((a, b) => b.voyageDate.localeCompare(a.voyageDate));
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
    if (offlineSeaMiles.enabled()) {
      const row = await offlineSeaMiles.read(id);
      return row ? mapRow(row) : null;
    }
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .select(REVIEW_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data) : null;
  }

  async getPendingForVessel(vesselId: string): Promise<SeaMileEntry[]> {
    if (offlineSeaMiles.enabled())
      return (await offlineSeaMiles.list(true))
        .filter(
          (r) => r.review_vessel_id === vesselId && (r.status === 'PENDING' || r.offlinePending)
        )
        .map(mapRow);
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
    if (offlineSeaMiles.enabled())
      return mapRow(
        await offlineSeaMiles.create({ user_id: userId, status: 'DRAFT', ...toRow(input) })
      );
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .insert({ user_id: userId, status: 'DRAFT', ...toRow(input) })
      .select(OWN_SELECT)
      .single();
    if (error) throw error;
    return mapRow(data);
  }

  async updateEditable(id: string, input: SeaMileEntryFields, version?: number): Promise<void> {
    if (offlineSeaMiles.enabled())
      return offlineSeaMiles.update(id, { ...toRow(input), status: 'DRAFT' }, version);
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .update({ ...toRow(input), status: 'DRAFT' })
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Updating sea-mile entry');
  }

  async submit(id: string, input: SeaMileEntryFields, version?: number): Promise<void> {
    if (offlineSeaMiles.enabled())
      return offlineSeaMiles.update(id, { ...toRow(input), status: 'PENDING' }, version);
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .update({ ...toRow(input), status: 'PENDING' })
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Submitting sea-mile entry');
  }

  async updatePendingAsCaptain(
    id: string,
    input: SeaMileEntryFields,
    version?: number
  ): Promise<void> {
    if (offlineSeaMiles.enabled()) return offlineSeaMiles.update(id, { ...toRow(input) }, version);
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .update(toRow(input))
      .eq('id', id)
      .eq('status', 'PENDING')
      .select('id');
    requireAffectedRows(data, error, 'Updating pending sea-mile entry');
  }

  async approve(id: string, version?: number): Promise<void> {
    if (offlineSeaMiles.enabled())
      return offlineSeaMiles.update(id, { status: 'APPROVED' }, version);
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .update({ status: 'APPROVED' })
      .eq('id', id)
      .eq('status', 'PENDING')
      .select('id');
    requireAffectedRows(data, error, 'Approving sea-mile entry');
  }

  async decline(id: string, comment: string, version?: number): Promise<void> {
    if (offlineSeaMiles.enabled())
      return offlineSeaMiles.update(
        id,
        { status: 'DECLINED', decline_comment: comment.trim() },
        version
      );
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .update({ status: 'DECLINED', decline_comment: comment.trim() })
      .eq('id', id)
      .eq('status', 'PENDING')
      .select('id');
    requireAffectedRows(data, error, 'Declining sea-mile entry');
  }

  async deleteEditable(id: string): Promise<void> {
    if (offlineSeaMiles.enabled()) await offlineSeaMiles.beforeOnline();
    const { data, error } = await supabase
      .from('sea_mile_entries')
      .delete()
      .eq('id', id)
      .select('id');
    requireAffectedRows(data, error, 'Deleting sea-mile entry');
    if (offlineSeaMiles.enabled()) await offlineSeaMiles.refresh();
  }
}

export default new SeaMilesService();
