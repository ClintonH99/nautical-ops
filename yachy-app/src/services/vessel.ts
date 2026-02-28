/**
 * Vessel Service
 * Handles vessel creation and management
 */

import { supabase } from './supabase';

export interface CreateVesselData {
  name: string;
  managementCompanyId?: string;
}

export interface Vessel {
  id: string;
  name: string;
  managementCompanyId?: string;
  inviteCode: string;
  inviteExpiry: string;
  createdAt: string;
  updatedAt: string;
}

class VesselService {
  /**
   * Generate a unique invite code
   */
  private generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous characters
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Check if invite code already exists
   */
  private async isInviteCodeUnique(code: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('vessels')
        .select('id')
        .eq('invite_code', code)
        .maybeSingle();

      if (error) throw error;
      return !data; // Returns true if no vessel found with this code
    } catch (error) {
      console.error('Check invite code error:', error);
      return false;
    }
  }

  /**
   * Generate a unique invite code
   */
  private async generateUniqueInviteCode(): Promise<string> {
    let code = this.generateInviteCode();
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const isUnique = await this.isInviteCodeUnique(code);
      if (isUnique) {
        return code;
      }
      code = this.generateInviteCode();
      attempts++;
    }

    throw new Error('Failed to generate unique invite code');
  }

  /**
   * Create a new vessel
   */
  async createVessel({ name, managementCompanyId }: CreateVesselData): Promise<Vessel> {
    try {
      // Generate unique invite code
      const inviteCode = await this.generateUniqueInviteCode();

      // Set expiry to 1 year from now
      const inviteExpiry = new Date();
      inviteExpiry.setFullYear(inviteExpiry.getFullYear() + 1);

      const vesselData = {
        name: name.trim(),
        management_company_id: managementCompanyId || null,
        invite_code: inviteCode,
        invite_expiry: inviteExpiry.toISOString(),
      };

      const { data, error } = await supabase
        .from('vessels')
        .insert([vesselData])
        .select()
        .single();

      if (error) throw error;

      return {
        id: data.id,
        name: data.name,
        managementCompanyId: data.management_company_id,
        inviteCode: data.invite_code,
        inviteExpiry: data.invite_expiry,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
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
        .single();

      if (error) throw error;

      return {
        id: data.id,
        name: data.name,
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
      const newCode = await this.generateUniqueInviteCode();

      // Extend expiry by 1 year
      const newExpiry = new Date();
      newExpiry.setFullYear(newExpiry.getFullYear() + 1);

      const { error } = await supabase
        .from('vessels')
        .update({
          invite_code: newCode,
          invite_expiry: newExpiry.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', vesselId);

      if (error) throw error;

      return newCode;
    } catch (error) {
      console.error('Regenerate invite code error:', error);
      throw error;
    }
  }

  /**
   * Upload a banner image for the vessel to Supabase Storage.
   * Stores as vessel-banners/<vesselId>/banner.jpg
   */
  async uploadBannerImage(vesselId: string, localUri: string): Promise<void> {
    const response = await fetch(localUri);
    const blob = await response.blob();
    const arrayBuffer = await new Response(blob).arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const { error } = await supabase.storage
      .from('vessel-banners')
      .upload(`${vesselId}/banner.jpg`, uint8Array, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) throw error;
  }

  /**
   * Return the public URL for a vessel's banner image.
   */
  getBannerPublicUrl(vesselId: string): string {
    const { data } = supabase.storage
      .from('vessel-banners')
      .getPublicUrl(`${vesselId}/banner.jpg`);
    return data.publicUrl;
  }

  /**
   * Update vessel name (HOD only)
   */
  async updateVesselName(vesselId: string, name: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('vessels')
        .update({
          name: name.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', vesselId);

      if (error) throw error;
    } catch (error) {
      console.error('Update vessel name error:', error);
      throw error;
    }
  }
}

export default new VesselService();
