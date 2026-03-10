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
          throw new Error('Email Address or Password is Incorrect, Try Again.');
        }
        throw error;
      }
      
      if (data.user) {
        const PROFILE_TIMEOUT_MS = 15000;
        const userDataPromise = this.getUserProfile(data.user.id);
        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('Profile load timed out. Please try again.')), PROFILE_TIMEOUT_MS)
        );
        let userData = await Promise.race([userDataPromise, timeoutPromise]);
        // If auth succeeded but no profile exists (edge case), create one
        if (!userData) {
          userData = await this.ensureOAuthUserProfile(data.user);
        }
        return { user: userData, session: data.session };
      }

      return { user: null, session: null };
    } catch (error) {
      if (__DEV__) console.error('Sign in error:', error);
      throw error;
    }
  }

  /**
   * Sign in with Google (OAuth)
   */
  async signInWithGoogle(): Promise<{ user: User | null; session: any }> {
    try {
      WebBrowser.maybeCompleteAuthSession();
      const redirectTo = makeRedirectUri({ preferLocalhost: false });
      // #region agent log
      try {
        const hasSpace = redirectTo.includes(' ');
        const firstChar = redirectTo.length ? redirectTo.charCodeAt(0) : -1;
        const lastChar = redirectTo.length ? redirectTo.charCodeAt(redirectTo.length - 1) : -1;
        if (__DEV__) console.log('[DEBUG H1,H5] redirectTo:', JSON.stringify(redirectTo), 'len:', redirectTo.length, 'hasSpace:', hasSpace);
        fetch('http://127.0.0.1:7242/ingest/4078e384-3658-4a9c-ad3e-69711ac24e59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c8c7a1'},body:JSON.stringify({sessionId:'c8c7a1',hypothesisId:'H1,H5',location:'auth.ts:79',message:'redirectTo value',data:{redirectTo,length:redirectTo.length,hasSpace,firstChar,lastChar,includesNauticalOps:redirectTo.includes('nautical-ops')},timestamp:Date.now()})}).catch(()=>{});
      } catch (_) {}
      // #endregion
      const isLocalhost = redirectTo.includes('localhost') || redirectTo.includes('127.0.0.1');
      if (Platform.OS !== 'web' && Device.isDevice && isLocalhost) {
        throw new Error(
          'Google Sign-In needs tunnel mode on a physical device. Restart with: cd yachy-app && npx expo start --tunnel\n\n' +
            'Then add the tunnel URL (shown in the terminal) to Supabase Auth → URL Configuration → Redirect URLs.'
        );
      }

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
      try {
        let redirectParam = '';
        try {
          const u = new URL(data.url);
          redirectParam = u.searchParams.get('redirect_uri') ?? u.searchParams.get('redirect_to') ?? u.searchParams.get('redirectTo') ?? '';
        } catch (_) {}
        fetch('http://127.0.0.1:7242/ingest/4078e384-3658-4a9c-ad3e-69711ac24e59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c8c7a1'},body:JSON.stringify({sessionId:'c8c7a1',hypothesisId:'H3',location:'auth.ts:97',message:'OAuth URL redirect param',data:{redirectParam,hasSpace:redirectParam.includes(' '),includesNauticalOps:redirectParam.includes('nautical-ops')},timestamp:Date.now()})}).catch(()=>{});
      } catch (_) {}
      // #endregion

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo) as { type: string; url?: string };
      // #region agent log
      try {
        const resUrl = result?.url ?? '';
        const has500 = resUrl.includes('500') || resUrl.includes('unexpected_failure');
        fetch('http://127.0.0.1:7242/ingest/4078e384-3658-4a9c-ad3e-69711ac24e59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c8c7a1'},body:JSON.stringify({sessionId:'c8c7a1',hypothesisId:'H2,H3',location:'auth.ts:openAuthResult',message:'WebBrowser result',data:{type:result?.type,urlLength:resUrl.length,has500,urlHost:resUrl?.split('/')[2]},timestamp:Date.now()})}).catch(()=>{});
      } catch (_) {}
      // #endregion
      if (result.type !== 'success' || !result.url) {
        return { user: null, session: null };
      }
      const authUrl = result.url;
      const { params, errorCode } = QueryParams.getQueryParams(authUrl);
      if (errorCode) throw new Error(errorCode);
      let access_token = (params as any)?.access_token;
      let refresh_token = (params as any)?.refresh_token;
      if (!access_token && authUrl.includes('#')) {
        const hash = authUrl.split('#')[1];
        const hashParams = new URLSearchParams(hash);
        access_token = hashParams.get('access_token') ?? undefined;
        refresh_token = hashParams.get('refresh_token') ?? undefined;
      }
      if (!access_token) return { user: null, session: null };

      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token,
        refresh_token: refresh_token ?? '',
      });
      if (sessionError) throw sessionError;
      if (!sessionData.user) return { user: null, session: null };

      const userData = await this.ensureOAuthUserProfile(sessionData.user);
      return { user: userData, session: sessionData.session };
    } catch (error: any) {
      // #region agent log
      try {
        fetch('http://127.0.0.1:7242/ingest/4078e384-3658-4a9c-ad3e-69711ac24e59',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c8c7a1'},body:JSON.stringify({sessionId:'c8c7a1',hypothesisId:'H1,H2,H3,H4,H5',location:'auth.ts:catch',message:'Google sign in error',data:{message:error?.message,code:error?.code,name:error?.name},timestamp:Date.now()})}).catch(()=>{});
      } catch (_) {}
      // #endregion
      if (__DEV__) console.error('Google sign in error:', error);
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
      if (__DEV__) console.error('Apple sign in error:', error);
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
      if (__DEV__) console.error('OAuth profile creation error:', error);
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
      if (__DEV__) {
        console.log('🚀 Starting signup process...');
        console.log('📧 Email:', email);
        console.log('🎫 Invite Code:', inviteCode || 'None');
        console.log('⚓ Vessel ID:', vesselId || 'None');
      }

      // For CREW with invite code: validate FIRST before creating any user
      // This ensures we never reserve the email if the invite code is invalid
      let validatedVessel: { id: string; name: string } | null = null;
      if (inviteCode && inviteCode.trim() && !vesselId) {
        const vessel = await this.validateInviteCode(inviteCode);
        if (!vessel) throw new Error('Invalid invite code');
        validatedVessel = vessel;
        if (__DEV__) console.log('✅ Invite code valid! Vessel:', vessel.name);
      }

      // Create the auth user (only after invite code validated for crew)
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) {
        if (__DEV__) console.error('❌ Auth signup error:', authError.message);
        if (authError.message.includes('already registered') || authError.message.includes('User already registered')) {
          throw new Error('Email address already in use');
        }
        throw authError;
      }

      if (authData.user) {
        if (__DEV__) console.log('✅ Auth user created:', authData.user.id);

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

        if (__DEV__) console.log('💾 Creating user profile with vessel_id:', userProfile.vessel_id || 'null');

        const { error: profileError } = await supabase
          .from('users')
          .insert([userProfile]);

        if (profileError) {
          if (__DEV__) console.error('❌ Profile creation error:', profileError);
          const code = (profileError as any)?.code;
          const msg = (profileError as any)?.message?.toLowerCase() || '';
          if (code === '23505' || msg.includes('users_email_key') || msg.includes('duplicate key')) {
            throw new Error('Email address already in use');
          }
          throw profileError;
        }

        if (__DEV__) console.log('✅ User profile created successfully!');

        // Regenerate invite code so it's single-use: one code per crew member
        if (joinedViaInviteCode && userProfile.vessel_id) {
          try {
            const newCode = await vesselService.regenerateInviteCode(userProfile.vessel_id);
            if (__DEV__) console.log('🔄 Invite code regenerated for next crew member:', newCode);
          } catch (regenError) {
            if (__DEV__) console.error('⚠️ Failed to regenerate invite code (non-fatal):', regenError);
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

        if (__DEV__) console.log('🎉 Signup complete! User:', mappedUser.name, 'Vessel ID:', mappedUser.vesselId);

        return { user: mappedUser, session: authData.session };
      }

      return { user: null, session: null };
    } catch (error: any) {
      const msg = error?.message?.toLowerCase() || '';
      const isInviteCodeError = msg.includes('invite code') || msg.includes('vessel not found') || msg.includes('cannot coerce') || msg.includes('expired');
      if (!isInviteCodeError && __DEV__) console.error('❌ Sign up error:', error.message || error);
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
      if (__DEV__) console.error('Sign out error:', error);
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
      if (__DEV__) console.error('Get session error:', error);
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
        if (__DEV__) console.log('No user profile found for:', userId);
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
      if (__DEV__) console.error('Get user profile error:', error);
      return null;
    }
  }

  /**
   * Validate invite code and get vessel
   */
  async validateInviteCode(inviteCode: string) {
    try {
      if (__DEV__) console.log('🔍 Validating invite code in database:', inviteCode);
      
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

      if (__DEV__) console.log('✅ Vessel found:', data.name, 'ID:', data.id);

      // Check if invite code is expired
      const expiryDate = new Date(data.invite_expiry);
      const now = new Date();
      if (__DEV__) {
        console.log('📅 Expiry date:', expiryDate.toISOString());
        console.log('📅 Current date:', now.toISOString());
      }
      
      if (expiryDate < now) {
        throw new Error('Invite code has expired');
      }

      if (__DEV__) console.log('✅ Invite code is valid and not expired');
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
        if (__DEV__) console.log('🔄 Invite code regenerated for next crew member');
      } catch (regenError) {
        if (__DEV__) console.error('⚠️ Failed to regenerate invite code (non-fatal):', regenError);
      }

      // Return updated user profile
      return await this.getUserProfile(userId);
    } catch (error: any) {
      const msg = error?.message?.toLowerCase() || '';
      const isInviteCodeError = msg.includes('invite code') || msg.includes('vessel not found') || msg.includes('cannot coerce') || msg.includes('expired');
      if (!isInviteCodeError && __DEV__) console.error('Join vessel error:', error);
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
