/**
 * Vessel Service
 * Handles vessel creation and management
 */

import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';
import { readFileBytesForUpload } from '../utils/fileUpload';

export interface CreateVesselData {
  name: string;
  managementCompanyId?: string;
  isSolo?: boolean;
}

export interface Vessel {
  id: string;
  name: string;
  imoNumber?: string;
  managementCompanyId?: string;
  inviteCode: string;
  inviteExpiry: string;
  createdAt: string;
  updatedAt: string;
}

class VesselService {
  /**
   * Create and assign a vessel through a protected server function. The app
   * never inserts a vessel or changes its own vessel/role directly.
   */
  async createVessel({ name, managementCompanyId, isSolo }: CreateVesselData): Promise<Vessel> {
    try {
      const { data, error } = isSolo
        ? await supabase.rpc('create_solo_vessel_for_current_user')
        : await supabase.rpc('create_captain_vessel', {
            p_name: name.trim(),
            p_management_company_id: managementCompanyId || null,
          });

      if (error) throw error;

      const row = data as any;

      return {
        id: row.id,
        name: row.name,
        managementCompanyId: row.management_company_id,
        inviteCode: row.invite_code ?? '',
        inviteExpiry: row.invite_expiry ?? '',
        createdAt: row.created_at ?? new Date().toISOString(),
        updatedAt: row.updated_at ?? new Date().toISOString(),
      };
    } catch (error) {
      console.error('Create vessel error:', error);
      throw error;
    }
  }

  /**
   * Get vessel by ID
   */
  async getVessel(vesselId: string): Promise<Vessel | null> {
    try {
      const { data, error } = await supabase
        .from('vessels')
        .select('*')
        .eq('id', vesselId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        id: data.id,
        name: data.name,
        imoNumber: data.imo_number,
        managementCompanyId: data.management_company_id,
        inviteCode: data.invite_code,
        inviteExpiry: data.invite_expiry,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    } catch (error) {
      console.error('Get vessel error:', error);
      return null;
    }
  }

  /**
   * Regenerate invite code for a vessel
   */
  async regenerateInviteCode(vesselId: string): Promise<string> {
    try {
      const { data: newCode, error: codeError } = await supabase.rpc(
        'regenerate_current_vessel_invite_code',
        { p_vessel_id: vesselId }
      );
      if (codeError || !newCode) throw codeError ?? new Error('Failed to generate invite code');

      return newCode as string;
    } catch (error) {
      console.error('Regenerate invite code error:', error);
      throw error;
    }
  }

  /**
   * Upload a banner image for the vessel to Supabase Storage.
   * Stores as vessel-banners/<vesselId>/banner.jpg
   * Returns the public URL with cache-bust param (like profile photo) so the image refreshes.
   */
  async uploadBannerImage(vesselId: string, localUri: string): Promise<string> {
    const fileBytes = await readFileBytesForUpload(localUri);

    const { error } = await supabase.storage
      .from('vessel-banners')
      .upload(`${vesselId}/banner.jpg`, fileBytes, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) throw error;

    return `${this.getBannerPublicUrl(vesselId)}?t=${Date.now()}`;
  }

  /**
   * Return the public URL for a vessel's banner image.
   * Optional cacheBust param appends ?t= for cache busting (use after upload or on refetch).
   */
  getBannerPublicUrl(vesselId: string, cacheBust?: number): string {
    const { data } = supabase.storage.from('vessel-banners').getPublicUrl(`${vesselId}/banner.jpg`);
    const base = data.publicUrl;
    return cacheBust != null ? `${base}?t=${cacheBust}` : base;
  }

  /**
   * Update vessel name (HOD only)
   */
  async updateVesselName(vesselId: string, name: string): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('vessels')
        .update({
          name: name.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', vesselId)
        .select('id');
      requireAffectedRows(data, error, 'Updating the vessel name');
    } catch (error) {
      console.error('Update vessel name error:', error);
      throw error;
    }
  }

  async updateVesselImo(vesselId: string, imoNumber: string): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('vessels')
        .update({
          imo_number: imoNumber.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', vesselId)
        .select('id');
      requireAffectedRows(data, error, 'Updating the vessel IMO number');
    } catch (error) {
      console.error('Update vessel IMO error:', error);
      throw error;
    }
  }
}
export default new VesselService();
