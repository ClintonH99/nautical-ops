/**
 * Authentication Service
 * Handles all authentication-related operations
 */

import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as Device from 'expo-device';
import { supabase } from './supabase';
import vesselService from './vessel';
import { User } from '../types';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData extends LoginCredentials {
  name: string;
  position: string;
  department: string;
  department2?: string | null; // Optional second department for crew
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

      if (error) {
        // Surface clearer messages for common Supabase auth errors
        if (error.message?.includes('Invalid login credentials')) {
          throw new Error('Email or password is incorrect. Please check and try again.');
        }
        if (error.message?.includes('Email not confirmed')) {
          throw new Error('Please check your email and click the confirmation link before signing in.');
        }
        throw error;
      }
      
      if (data.user) {
        let userData = await this.getUserProfile(data.user.id);
        // If auth succeeded but no profile exists (edge case), create one
        if (!userData) {
          userData = await this.ensureOAuthUserProfile(data.user);
        }
        return { user: userData, session: data.session };
      }

      return { user: null, session: null };
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  }

  /**
   * Sign in with Google (OAuth)
   */
  async signInWithGoogle(): Promise<{ user: User | null; session: any }> {
    try {
      WebBrowser.maybeCompleteAuthSession();
      // #region agent log
      const _redirectTo = makeRedirectUri({ preferLocalhost: false });
      console.log('[GoogleAuth] redirectTo:', _redirectTo);
      fetch('http://127.0.0.1:7242/ingest/4078e384-3658-4a9c-ad3e-69711ac24e59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'02e7fe'},body:JSON.stringify({sessionId:'02e7fe',location:'auth.ts:google:redirectTo',message:'redirectTo',data:{redirectTo:_redirectTo},hypothesisId:'H1,H4',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const redirectTo = _redirectTo;
      const isLocalhost = redirectTo.includes('localhost') || redirectTo.includes('127.0.0.1');
      if (Platform.OS !== 'web' && Device.isDevice && isLocalhost) {
        throw new Error(
          'Google Sign-In needs tunnel mode on a physical device. Restart with: cd yachy-app && npx expo start --tunnel\n\n' +
            'Then add the tunnel URL (shown in the terminal) to Supabase Auth → URL Configuration → Redirect URLs.'
        );
      }

      // #region agent log
      console.log('[GoogleAuth] calling signInWithOAuth...');
      fetch('http://127.0.0.1:7242/ingest/4078e384-3658-4a9c-ad3e-69711ac24e59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'02e7fe'},body:JSON.stringify({sessionId:'02e7fe',location:'auth.ts:google:beforeOAuth',message:'before signInWithOAuth',data:{},hypothesisId:'H2',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('No OAuth URL returned');
      // #region agent log
      console.log('[GoogleAuth] got OAuth URL, opening browser...');
      fetch('http://127.0.0.1:7242/ingest/4078e384-3658-4a9c-ad3e-69711ac24e59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'02e7fe'},body:JSON.stringify({sessionId:'02e7fe',location:'auth.ts:google:beforeBrowser',message:'before openAuthSessionAsync',data:{},hypothesisId:'H3',timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      // #region agent log
      console.log('[GoogleAuth] browser returned, type:', result.type, 'hasUrl:', !!result.url, 'urlStart:', result.url?.substring(0, 50));
      // #endregion
      if (result.type !== 'success' || !result.url) {
        return { user: null, session: null };
      }

      const { params, errorCode } = QueryParams.getQueryParams(result.url);
      if (errorCode) throw new Error(errorCode);
      let access_token = (params as any)?.access_token;
      let refresh_token = (params as any)?.refresh_token;
      if (!access_token && result.url.includes('#')) {
        const hash = result.url.split('#')[1];
        const hashParams = new URLSearchParams(hash);
        access_token = hashParams.get('access_token') ?? undefined;
        refresh_token = hashParams.get('refresh_token') ?? undefined;
      }
      // #region agent log
      console.log('[GoogleAuth] tokens:', access_token ? 'have access_token' : 'NO access_token', 'hash parse:', result.url.includes('#'));
      // #endregion
      if (!access_token) return { user: null, session: null };

      // #region agent log
      console.log('[GoogleAuth] calling setSession...');
      // #endregion
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token,
        refresh_token: refresh_token ?? '',
      });
      if (sessionError) throw sessionError;
      if (!sessionData.user) return { user: null, session: null };

      // #region agent log
      console.log('[GoogleAuth] setSession OK, ensuring profile...');
      // #endregion
      const userData = await this.ensureOAuthUserProfile(sessionData.user);
      return { user: userData, session: sessionData.session };
    } catch (error: any) {
      console.error('Google sign in error:', error);
      throw error;
    }
  }

  /**
   * Sign in with Apple (native, iOS only)
   */
  async signInWithApple(): Promise<{ user: User | null; session: any }> {
    if (Platform.OS !== 'ios') {
      throw new Error('Sign in with Apple is only available on iOS');
    }
    try {
      const AppleAuthentication = require('expo-apple-authentication');
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce
      );

      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      if (!credential.identityToken) throw new Error('No identity token from Apple');

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        nonce: rawNonce,
      });
      if (error) throw error;
      if (!data.user) return { user: null, session: null };

      if (credential.fullName) {
        const fullName = [
          credential.fullName.givenName,
          credential.fullName.middleName,
          credential.fullName.familyName,
        ]
          .filter(Boolean)
          .join(' ');
        if (fullName) {
          await supabase.auth.updateUser({ data: { full_name: fullName } });
        }
      }

      const userData = await this.ensureOAuthUserProfile(data.user, credential.fullName);
      return { user: userData, session: data.session };
    } catch (error: any) {
      if (error?.code === 'ERR_REQUEST_CANCELED') {
        return { user: null, session: null };
      }
      console.error('Apple sign in error:', error);
      throw error;
    }
  }

  /**
   * Ensure OAuth user has a profile in users table; create with defaults if missing
   */
  private async ensureOAuthUserProfile(
    authUser: { id: string; email?: string | null; user_metadata?: Record<string, any> },
    appleFullName?: { givenName?: string | null; middleName?: string | null; familyName?: string | null } | null
  ): Promise<User | null> {
    let profile = await this.getUserProfile(authUser.id);
    if (profile) return profile;

    const name =
      appleFullName
        ? [appleFullName.givenName, appleFullName.middleName, appleFullName.familyName]
            .filter((s): s is string => s != null && s !== '')
            .join(' ')
        : authUser.user_metadata?.full_name ??
          authUser.user_metadata?.name ??
          authUser.email?.split('@')[0] ??
          'Crew Member';
    const email = authUser.email ?? authUser.user_metadata?.email ?? '';

    const userProfile = {
      id: authUser.id,
      email,
      name,
      position: 'Crew',
      department: 'INTERIOR',
      role: 'CREW',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('users').insert([userProfile]);
    if (error) {
      console.error('OAuth profile creation error:', error);
      return null;
    }

    return {
      id: userProfile.id,
      email: userProfile.email,
      name: userProfile.name,
      position: userProfile.position,
      department: userProfile.department as any,
      role: userProfile.role as any,
      vesselId: undefined,
      createdAt: userProfile.created_at,
      updatedAt: userProfile.updated_at,
    };
  }

  /**
   * Sign up with email and password
   */
  async signUp({ email, password, name, position, department, department2, inviteCode, vesselId }: RegisterData) {
    try {
      console.log('🚀 Starting signup process...');
      console.log('📧 Email:', email);
      console.log('🎫 Invite Code:', inviteCode || 'None');
      console.log('⚓ Vessel ID:', vesselId || 'None');

      // For CREW with invite code: validate FIRST before creating any user
      // This ensures we never reserve the email if the invite code is invalid
      let validatedVessel: { id: string; name: string } | null = null;
      if (inviteCode && inviteCode.trim() && !vesselId) {
        const vessel = await this.validateInviteCode(inviteCode);
        if (!vessel) throw new Error('Invalid invite code');
        validatedVessel = vessel;
        console.log('✅ Invite code valid! Vessel:', vessel.name);
      }

      // Create the auth user (only after invite code validated for crew)
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) {
        console.error('❌ Auth signup error:', authError.message);
        if (authError.message.includes('already registered') || authError.message.includes('User already registered')) {
          throw new Error('This email is already registered. Please use a different email or sign in instead.');
        }
        throw authError;
      }

      if (authData.user) {
        console.log('✅ Auth user created:', authData.user.id);

        const role = vesselId ? 'HOD' : 'CREW';
        const userProfile: any = {
          id: authData.user.id,
          email,
          name,
          position,
          department: department as any,
          department_2: department2 || null,
          role: role as any,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        let joinedViaInviteCode = false;
        if (vesselId) {
          userProfile.vessel_id = vesselId;
        } else if (validatedVessel) {
          userProfile.vessel_id = validatedVessel.id;
          joinedViaInviteCode = true;
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

        // Regenerate invite code so it's single-use: one code per crew member
        if (joinedViaInviteCode && userProfile.vessel_id) {
          try {
            const newCode = await vesselService.regenerateInviteCode(userProfile.vessel_id);
            console.log('🔄 Invite code regenerated for next crew member:', newCode);
          } catch (regenError) {
            console.error('⚠️ Failed to regenerate invite code (non-fatal):', regenError);
          }
        }

        // Map the profile to User type (snake_case -> camelCase)
        const mappedUser: User = {
          id: userProfile.id,
          email: userProfile.email,
          name: userProfile.name,
          position: userProfile.position,
          department: userProfile.department,
          department2: userProfile.department_2 ?? null,
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
      const msg = error?.message?.toLowerCase() || '';
      const isInviteCodeError = msg.includes('invite code') || msg.includes('vessel not found') || msg.includes('cannot coerce') || msg.includes('expired');
      if (!isInviteCodeError) console.error('❌ Sign up error:', error.message || error);
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
        department2: data.department_2 ?? null,
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
        .maybeSingle();

      if (error) {
        throw new Error('Invalid invite code');
      }

      if (!data) {
        throw new Error('Invalid invite code');
      }

      console.log('✅ Vessel found:', data.name, 'ID:', data.id);

      // Check if invite code is expired
      const expiryDate = new Date(data.invite_expiry);
      const now = new Date();
      console.log('📅 Expiry date:', expiryDate.toISOString());
      console.log('📅 Current date:', now.toISOString());
      
      if (expiryDate < now) {
        throw new Error('Invite code has expired');
      }

      console.log('✅ Invite code is valid and not expired');
      return data;
    } catch (error: any) {
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

      // Regenerate invite code so it's single-use: one code per crew member
      try {
        await vesselService.regenerateInviteCode(vessel.id);
        console.log('🔄 Invite code regenerated for next crew member');
      } catch (regenError) {
        console.error('⚠️ Failed to regenerate invite code (non-fatal):', regenError);
      }

      // Return updated user profile
      return await this.getUserProfile(userId);
    } catch (error: any) {
      const msg = error?.message?.toLowerCase() || '';
      const isInviteCodeError = msg.includes('invite code') || msg.includes('vessel not found') || msg.includes('cannot coerce') || msg.includes('expired');
      if (!isInviteCodeError) console.error('Join vessel error:', error);
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
