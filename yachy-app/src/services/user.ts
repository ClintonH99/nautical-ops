/**
 * User Service
 * Handles user profile management and crew operations
 */

import { supabase } from './supabase';
import { User, Department, UserRole } from '../types';

export interface UpdateProfileData {
  name?: string;
  position?: string;
  department?: Department;
  profilePhoto?: string;
}

class UserService {
  /**
   * Update user profile
   */
  async updateProfile(userId: string, data: UpdateProfileData): Promise<User | null> {
    try {
      const updateData: any = {
        updated_at: new Date().toISOString(),
      };

      if (data.name) updateData.name = data.name.trim();
      if (data.position) updateData.position = data.position.trim();
      if (data.department) updateData.department = data.department;
      if (data.profilePhoto !== undefined) updateData.profile_photo = data.profilePhoto;

      const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userId);

      if (error) throw error;

      // Fetch and return updated profile
      const { data: userData, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (fetchError) throw fetchError;

      // Map snake_case to camelCase
      return {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        position: userData.position,
        department: userData.department,
        role: userData.role,
        vesselId: userData.vessel_id,
        profilePhoto: userData.profile_photo,
        createdAt: userData.created_at,
        updatedAt: userData.updated_at,
      } as User;
    } catch (error) {
      console.error('Update profile error:', error);
      throw error;
    }
  }

  /**
   * Get all crew members for a vessel
   */
  async getVesselCrew(vesselId: string): Promise<User[]> {
    try {
      console.log('🔍 getVesselCrew - Fetching crew for vessel:', vesselId);
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('❌ getVesselCrew - Error:', error);
        throw error;
      }

      console.log('✅ getVesselCrew - Raw data received:', data?.length || 0, 'users');
      console.log('📋 getVesselCrew - Data:', JSON.stringify(data, null, 2));

      if (!data || data.length === 0) {
        console.warn('⚠️ getVesselCrew - No crew members found for vessel:', vesselId);
        console.log('💡 This could mean:');
        console.log('   1. No crew has joined this vessel yet');
        console.log('   2. RLS policy is blocking the query');
        console.log('   3. vessel_id mismatch in database');
        return [];
      }

      // Map snake_case to camelCase
      const mappedUsers = data.map(user => ({
        id: user.id,
        email: user.email,
        name: user.name,
        position: user.position,
        department: user.department,
        department2: user.department_2 ?? null,
        role: user.role,
        vesselId: user.vessel_id,
        profilePhoto: user.profile_photo,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      })) as User[];

      console.log('✅ getVesselCrew - Returning', mappedUsers.length, 'crew members');
      return mappedUsers;
    } catch (error) {
      console.error('❌ Get vessel crew error:', error);
      throw error;
    }
  }

  /**
   * Remove crew member from vessel (HOD only)
   */
  async removeCrewMember(userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('users')
        .update({
          vessel_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) throw error;
    } catch (error) {
      console.error('Remove crew member error:', error);
      throw error;
    }
  }

  /**
   * Update user role (HOD only - promote/demote crew)
   */
  async updateUserRole(userId: string, role: UserRole): Promise<void> {
    try {
      const { error } = await supabase
        .from('users')
        .update({
          role,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) throw error;
    } catch (error) {
      console.error('Update user role error:', error);
      throw error;
    }
  }

  /**
   * Return the public URL for a user's profile photo.
   * Mirrors vesselService.getBannerPublicUrl - deterministic path per user.
   */
  getProfilePhotoUrl(userId: string): string {
    const { data } = supabase.storage
      .from('profile-photos')
      .getPublicUrl(`${userId}/avatar.jpg`);
    return data.publicUrl;
  }

  /**
   * Upload profile photo to Supabase Storage.
   * Mirrors vesselService.uploadBannerImage - path: {userId}/avatar.jpg
   */
  async uploadProfilePhoto(userId: string, fileUri: string): Promise<string> {
    const response = await fetch(fileUri);
    const blob = await response.blob();
    const arrayBuffer = await new Response(blob).arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const { error } = await supabase.storage
      .from('profile-photos')
      .upload(`${userId}/avatar.jpg`, uint8Array, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) throw error;

    return `${this.getProfilePhotoUrl(userId)}?t=${Date.now()}`;
  }

  /**
   * Delete profile photo from Supabase Storage
   */
  async deleteProfilePhoto(userId: string): Promise<void> {
    const { error } = await supabase.storage
      .from('profile-photos')
      .remove([`${userId}/avatar.jpg`]);

    if (error) {
      console.error('Delete profile photo error:', error);
    }
  }
}

export default new UserService();
