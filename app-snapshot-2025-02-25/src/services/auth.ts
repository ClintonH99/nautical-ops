/**
 * Authentication Service
 * Handles all authentication-related operations
 */

import { supabase } from './supabase';
import { User } from '../types';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData extends LoginCredentials {
  name: string;
  position: string;
  department: string;
  inviteCode?: string;
  vesselId?: string; // For when user creates their own vessel
}

class AuthService {
  /**
   * Sign in with email and password
   */
  async signIn({ email, password }: LoginCredentials) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      
      if (data.user) {
        const userData = await this.getUserProfile(data.user.id);
        return { user: userData, session: data.session };
      }

      return { user: null, session: null };
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  }

  /**
   * Sign up with email and password
   */
  async signUp({ email, password, name, position, department, inviteCode, vesselId }: RegisterData) {
    try {
      console.log('🚀 Starting signup process...');
      console.log('📧 Email:', email);
      console.log('👤 Name:', name);
      console.log('🎫 Invite Code:', inviteCode || 'None');
      console.log('⚓ Vessel ID:', vesselId || 'None');

      // First, create the auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) {
        console.error('❌ Auth signup error:', authError.message);
        // Provide more helpful error message for common issues
        if (authError.message.includes('already registered') || authError.message.includes('User already registered')) {
          throw new Error('This email is already registered. Please use a different email or sign in instead.');
        }
        throw authError;
      }

      if (authData.user) {
        console.log('✅ Auth user created:', authData.user.id);

        // Determine user role (HOD for vessel creator, CREW otherwise)
        const role = vesselId ? 'HOD' : 'CREW';
        console.log('👔 Assigned role:', role);

        // Then create the user profile
        const userProfile: any = {
          id: authData.user.id,
          email,
          name,
          position,
          department: department as any,
          role: role as any,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // If vesselId provided (user created vessel), use it
        if (vesselId) {
          console.log('⚓ Using provided vessel ID:', vesselId);
          userProfile.vessel_id = vesselId;
        }
        // Otherwise, if invite code provided, validate and link to vessel
        else if (inviteCode && inviteCode.trim()) {
          console.log('🔍 Validating invite code:', inviteCode);
          try {
            const vessel = await this.validateInviteCode(inviteCode);
            if (vessel) {
              console.log('✅ Invite code valid! Vessel found:', vessel.name, '(ID:', vessel.id, ')');
              userProfile.vessel_id = vessel.id;
            } else {
              console.error('❌ Invite code validation returned null');
              throw new Error('Invalid invite code');
            }
          } catch (inviteError: any) {
            console.error('❌ Invite code validation failed:', inviteError.message);
            throw new Error(`Invalid invite code: ${inviteError.message}`);
          }
        } else {
          console.log('ℹ️ No vessel assignment (Captain without vessel or no invite code)');
        }

        console.log('💾 Creating user profile with vessel_id:', userProfile.vessel_id || 'null');

        const { error: profileError } = await supabase
          .from('users')
          .insert([userProfile]);

        if (profileError) {
          console.error('❌ Profile creation error:', profileError);
          throw profileError;
        }

        console.log('✅ User profile created successfully!');

        // Map the profile to User type (snake_case -> camelCase)
        const mappedUser: User = {
          id: userProfile.id,
          email: userProfile.email,
          name: userProfile.name,
          position: userProfile.position,
          department: userProfile.department,
          role: userProfile.role,
          vesselId: userProfile.vessel_id, // Map vessel_id to vesselId
          profilePhoto: userProfile.profile_photo,
          createdAt: userProfile.created_at,
          updatedAt: userProfile.updated_at,
        };

        console.log('🎉 Signup complete! User:', mappedUser.name, 'Vessel ID:', mappedUser.vesselId);

        return { user: mappedUser, session: authData.session };
      }

      return { user: null, session: null };
    } catch (error: any) {
      console.error('❌ Sign up error:', error.message || error);
      throw error;
    }
  }

  /**
   * Sign out
   */
  async signOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  }

  /**
   * Get current session
   */
  async getSession() {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session;
    } catch (error) {
      console.error('Get session error:', error);
      return null;
    }
  }

  /**
   * Get user profile from database
   */
  async getUserProfile(userId: string): Promise<User | null> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      
      // If no user found, return null (user doesn't have a profile yet)
      if (!data) {
        console.log('No user profile found for:', userId);
        return null;
      }
      
      // Map snake_case database columns to camelCase User type
      return {
        id: data.id,
        email: data.email,
        name: data.name,
        position: data.position,
        department: data.department,
        role: data.role,
        vesselId: data.vessel_id, // Map vessel_id to vesselId
        profilePhoto: data.profile_photo,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      } as User;
    } catch (error) {
      console.error('Get user profile error:', error);
      return null;
    }
  }

  /**
   * Validate invite code and get vessel
   */
  async validateInviteCode(inviteCode: string) {
    try {
      console.log('🔍 Validating invite code in database:', inviteCode);
      
      const { data, error } = await supabase
        .from('vessels')
        .select('*')
        .eq('invite_code', inviteCode)
        .single();

      if (error) {
        console.error('❌ Database error when validating invite code:', error.message);
        throw new Error('Invalid invite code - vessel not found');
      }

      if (!data) {
        console.error('❌ No vessel found with invite code:', inviteCode);
        throw new Error('Invalid invite code - no vessel found');
      }

      console.log('✅ Vessel found:', data.name, 'ID:', data.id);

      // Check if invite code is expired
      const expiryDate = new Date(data.invite_expiry);
      const now = new Date();
      console.log('📅 Expiry date:', expiryDate.toISOString());
      console.log('📅 Current date:', now.toISOString());
      
      if (expiryDate < now) {
        console.error('❌ Invite code has expired');
        throw new Error('Invite code has expired - ask your captain for a new code');
      }

      console.log('✅ Invite code is valid and not expired');
      return data;
    } catch (error: any) {
      console.error('❌ Validate invite code error:', error.message || error);
      throw error;
    }
  }

  /**
   * Join a vessel using invite code (for users who registered without a vessel)
   */
  async joinVessel(userId: string, inviteCode: string) {
    try {
      // Validate invite code and get vessel
      const vessel = await this.validateInviteCode(inviteCode);
      
      if (!vessel) {
        throw new Error('Invalid invite code');
      }

      // Update user's vessel_id
      const { error } = await supabase
        .from('users')
        .update({ 
          vessel_id: vessel.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) throw error;

      // Return updated user profile
      return await this.getUserProfile(userId);
    } catch (error) {
      console.error('Join vessel error:', error);
      throw error;
    }
  }

  /**
   * Listen to auth state changes
   */
  onAuthStateChange(callback: (user: User | null) => void) {
    return supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const userData = await this.getUserProfile(session.user.id);
        callback(userData);
      } else {
        callback(null);
      }
    });
  }
}

export default new AuthService();
