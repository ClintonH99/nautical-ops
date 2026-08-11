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
  department2?: string | null;
  contractType?: string;
  inviteCode?: string;
  vesselId?: string;
  role?: string;
}

const PLAN_MAX_CREW: Record<string, number> = {
  '1_5': 5,
  '6_10': 10,
  '11_15': 15,
  '16_25': 25,
  '26_40': 40,
  '40_plus': Infinity,
};

class AuthService {
  async signIn({ email, password }: LoginCredentials) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message?.includes('Invalid login credentials')) {
          throw new Error('Email Address or Password is Incorrect, Try Again.');
        }
        throw error;
      }
      if (data.user) {
        const PROFILE_TIMEOUT_MS = 15000;
        const userDataPromise = this.getUserProfile(data.user.id);
        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(
            () => reject(new Error('Profile load timed out. Please try again.')),
            PROFILE_TIMEOUT_MS
          )
        );
        let userData = await Promise.race([userDataPromise, timeoutPromise]);
        if (!userData) {
          userData = await this.ensureOAuthUserProfile(data.user);
        }
        return { user: userData, session: data.session };
      }
      return { user: null, session: null };
    } catch (error: any) {
      if (__DEV__) console.error('Sign in error:', error);
      const msg = String(error?.message ?? '').toLowerCase();
      const isNetworkError =
        msg.includes('network request failed') ||
        msg.includes('network error') ||
        msg.includes('fetch failed') ||
        msg.includes('authretryablefetcherror');
      if (isNetworkError) {
        throw new Error('Unable to connect. Please check your internet connection and try again.');
      }
      throw error;
    }
  }

  async signInWithGoogle(): Promise<{ user: User | null; session: any }> {
    try {
      WebBrowser.maybeCompleteAuthSession();
      const redirectTo = makeRedirectUri({ scheme: 'nauticalops', preferLocalhost: false });
      const isLocalhost = redirectTo.includes('localhost') || redirectTo.includes('127.0.0.1');
      if (Platform.OS !== 'web' && Device.isDevice && isLocalhost) {
        throw new Error(
          'Google Sign-In needs tunnel mode on a physical device. Restart with: cd yachy-app && npx expo start --tunnel\n\nThen add the tunnel URL (shown in the terminal) to Supabase Auth → URL Configuration → Redirect URLs.'
        );
      }
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('No OAuth URL returned');
      const result = (await WebBrowser.openAuthSessionAsync(data.url, redirectTo)) as {
        type: string;
        url?: string;
      };
      if (result.type !== 'success' || !result.url) return { user: null, session: null };
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
      if (__DEV__) console.error('Google sign in error:', error);
      throw error;
    }
  }

  async signInWithApple(): Promise<{ user: User | null; session: any }> {
    if (Platform.OS === 'android') {
      throw new Error('Sign in with Apple is not available on Android');
    }
    if (Platform.OS === 'web') {
      try {
        WebBrowser.maybeCompleteAuthSession();
        const redirectTo = makeRedirectUri({ scheme: 'nauticalops', preferLocalhost: false });
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'apple',
          options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error) throw error;
        if (!data?.url) throw new Error('No OAuth URL returned');
        const result = (await WebBrowser.openAuthSessionAsync(data.url, redirectTo)) as {
          type: string;
          url?: string;
        };
        if (result.type !== 'success' || !result.url) return { user: null, session: null };
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
        if (__DEV__) console.error('Apple sign in (web) error:', error);
        throw error;
      }
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
      if (error?.code === 'ERR_REQUEST_CANCELED') return { user: null, session: null };
      if (__DEV__) console.error('Apple sign in error:', error);
      throw error;
    }
  }

  private async ensureOAuthUserProfile(
    authUser: { id: string; email?: string | null; user_metadata?: Record<string, any> },
    appleFullName?: {
      givenName?: string | null;
      middleName?: string | null;
      familyName?: string | null;
    } | null
  ): Promise<User | null> {
    let profile = await this.getUserProfile(authUser.id);
    if (profile) return profile;
    const name = appleFullName
      ? [appleFullName.givenName, appleFullName.middleName, appleFullName.familyName]
          .filter((s): s is string => s != null && s !== '')
          .join(' ')
      : (authUser.user_metadata?.full_name ??
        authUser.user_metadata?.name ??
        authUser.email?.split('@')[0] ??
        'Crew Member');
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

  async signUp({
    email,
    password,
    name,
    position,
    department,
    department2,
    contractType,
    inviteCode,
    vesselId,
    role: explicitRole,
  }: RegisterData) {
    try {
      if (__DEV__) {
        console.log('🚀 Starting signup process...');
        console.log('📧 Email:', email);
        console.log('🎫 Invite Code:', inviteCode || 'None');
        console.log('⚓ Vessel ID:', vesselId || 'None');
      }
      let validatedVessel: { id: string; name: string } | null = null;
      if (inviteCode && inviteCode.trim() && !vesselId) {
        const vessel = await this.validateInviteCode(inviteCode);
        if (!vessel) throw new Error('Invalid invite code');
        validatedVessel = vessel;
        if (__DEV__) console.log('✅ Invite code valid! Vessel:', vessel.name);
      }
      const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) {
        if (__DEV__) console.error('❌ Auth signup error:', authError.message);
        if (
          authError.message.includes('already registered') ||
          authError.message.includes('User already registered')
        ) {
          throw new Error('Email address already in use');
        }
        throw authError;
      }
      if (authData.user) {
        if (__DEV__) console.log('✅ Auth user created:', authData.user.id);
        const role = explicitRole ?? (vesselId ? 'HOD' : 'CREW');
        const userProfile: any = {
          id: authData.user.id,
          email,
          name,
          position,
          department: department as any,
          department_2: department2 || null,
          contract_type: contractType || 'permanent',
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
        } else if (role === 'CREW') {
          // No invite code provided - give this crew member their own
          // private vessel automatically, same createVessel() a Captain
          // uses, just auto-named rather than asked for a name. They can
          // move to a real vessel later via Join Vessel with a real code.
          const soloVessel = await vesselService.createVessel({ name: 'Crew Account', isSolo: true });
          userProfile.vessel_id = soloVessel.id;
        }
        if (__DEV__)
          console.log('💾 Creating user profile with vessel_id:', userProfile.vessel_id || 'null');
        const { error: profileError } = await supabase.from('users').insert([userProfile]);
        if (profileError) {
          if (__DEV__) console.error('❌ Profile creation error:', profileError);
          const code = (profileError as any)?.code;
          const msg = (profileError as any)?.message?.toLowerCase() || '';
          if (
            code === '23505' ||
            msg.includes('users_email_key') ||
            msg.includes('duplicate key')
          ) {
            throw new Error('Email address already in use');
          }
          throw profileError;
        }
        if (__DEV__) console.log('✅ User profile created successfully!');
        if (joinedViaInviteCode && userProfile.vessel_id) {
          try {
            const newCode = await vesselService.regenerateInviteCode(userProfile.vessel_id);
            if (__DEV__) console.log('🔄 Invite code regenerated for next crew member:', newCode);
          } catch (regenError) {
            if (__DEV__)
              console.error('⚠️ Failed to regenerate invite code (non-fatal):', regenError);
          }
        }
        const mappedUser: User = {
          id: userProfile.id,
          email: userProfile.email,
          name: userProfile.name,
          position: userProfile.position,
          department: userProfile.department,
          department2: userProfile.department_2 ?? null,
          contractType: userProfile.contract_type ?? 'permanent',
          rotationGroupId: userProfile.rotation_group_id ?? null,
          role: userProfile.role,
          vesselId: userProfile.vessel_id,
          profilePhoto: userProfile.profile_photo,
          createdAt: userProfile.created_at,
          updatedAt: userProfile.updated_at,
        };
        if (__DEV__)
          console.log(
            '🎉 Signup complete! User:',
            mappedUser.name,
            'Vessel ID:',
            mappedUser.vesselId
          );
        return { user: mappedUser, session: authData.session };
      }
      return { user: null, session: null };
    } catch (error: any) {
      const msg = error?.message?.toLowerCase() || '';
      const isInviteCodeError =
        msg.includes('invite code') ||
        msg.includes('vessel not found') ||
        msg.includes('cannot coerce') ||
        msg.includes('expired') ||
        msg.includes('crew limit');
      if (!isInviteCodeError && __DEV__) console.error('❌ Sign up error:', error.message || error);
      throw error;
    }
  }

  async signOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      if (__DEV__) console.error('Sign out error:', error);
      throw error;
    }
  }

  async getSession() {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session;
    } catch (error: any) {
      const msg = String(error?.message ?? '').toLowerCase();
      const isInvalidRefreshToken =
        msg.includes('invalid refresh token') ||
        msg.includes('refresh token not found') ||
        msg.includes('refresh token expired') ||
        msg.includes('refresh token revoked');
      if (isInvalidRefreshToken) {
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch {
          /* best-effort clear */
        }
        if (__DEV__)
          console.warn('[Auth] Cleared invalid refresh token; user will need to sign in again.');
      } else if (__DEV__) {
        console.error('Get session error:', error);
      }
      return null;
    }
  }

  async getUserProfile(userId: string): Promise<User | null> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        if (__DEV__) console.log('No user profile found for:', userId);
        return null;
      }
      return {
        id: data.id,
        email: data.email,
        name: data.name,
        position: data.position,
        department: data.department,
        department2: data.department_2 ?? null,
        contractType: data.contract_type ?? 'permanent',
        rotationGroupId: data.rotation_group_id ?? null,
        role: data.role,
        vesselId: data.vessel_id,
        profilePhoto: data.profile_photo,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      } as User;
    } catch (error) {
      if (__DEV__) console.error('Get user profile error:', error);
      return null;
    }
  }

  async getUserProfileWithRetry(userId: string): Promise<User | null> {
    const ATTEMPT_MS = 2500;
    const BETWEEN_MS = 400;
    const FINAL_RACE_MS = 5000;
    const race = (ms: number) =>
      Promise.race([
        this.getUserProfile(userId),
        new Promise<User | null>((resolve) => setTimeout(() => resolve(null), ms)),
      ]);
    for (let attempt = 0; attempt < 2; attempt++) {
      const row = await race(ATTEMPT_MS);
      if (row) return row;
      await new Promise((r) => setTimeout(r, BETWEEN_MS));
    }
    return race(FINAL_RACE_MS);
  }

  async validateInviteCode(inviteCode: string) {
    try {
      if (__DEV__) console.log('🔍 Validating invite code in database:', inviteCode);
      const { data, error } = await supabase
        .from('vessels')
        .select('*')
        .eq('invite_code', inviteCode)
        .maybeSingle();
      if (error) throw new Error('Invalid invite code');
      if (!data) throw new Error('Invalid invite code');
      if (__DEV__) console.log('✅ Vessel found:', data.name, 'ID:', data.id);

      // Check if invite code is expired
      const expiryDate = new Date(data.invite_expiry);
      const now = new Date();
      if (__DEV__) {
        console.log('📅 Expiry date:', expiryDate.toISOString());
        console.log('📅 Current date:', now.toISOString());
      }
      if (expiryDate < now) throw new Error('Invite code has expired');

      // Check crew limit against subscription plan
      const { data: subscription } = await supabase
        .from('vessel_subscriptions')
        .select('plan_tier, status')
        .eq('vessel_id', data.id)
        .in('status', ['active', 'trialing'])
        .maybeSingle();

      if (!subscription) {
        throw new Error('This vessel does not have an active subscription. Ask the Captain to subscribe before crew can join.');
      }

      if (subscription) {
        const maxCrew = PLAN_MAX_CREW[subscription.plan_tier] ?? Infinity;
        if (maxCrew !== Infinity) {
          const { count } = await supabase
            .from('users')
            .select('id', { count: 'exact', head: true })
            .eq('vessel_id', data.id);
          const currentCount = count ?? 0;
          if (__DEV__) console.log(`👥 Crew count: ${currentCount}/${maxCrew}`);
          if (currentCount >= maxCrew) {
            throw new Error(
              `This vessel has reached its crew limit of ${maxCrew}. The captain needs to upgrade their plan to add more crew.`
            );
          }
        }
      }

      if (__DEV__) console.log('✅ Invite code is valid and not expired');
      return data;
    } catch (error: any) {
      throw error;
    }
  }

  async joinVessel(userId: string, inviteCode: string) {
    try {
      const { data: currentUserRow, error: currentUserError } = await supabase
        .from('users')
        .select('role, vessel_id')
        .eq('id', userId)
        .single();
      if (currentUserError) throw currentUserError;

      // A Captain/MOV can only leave a vessel if at least one other Captain/MOV
      // remains there - never leave a vessel with zero people able to manage it.
      if (currentUserRow?.role === 'CAPTAIN_MOV' && currentUserRow?.vessel_id) {
        const { count, error: countError } = await supabase
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('vessel_id', currentUserRow.vessel_id)
          .eq('role', 'CAPTAIN_MOV');
        if (countError) throw countError;
        if ((count ?? 0) <= 1) {
          throw new Error(
            'You are the only Captain/MOV on your current vessel. Promote another crew member to Captain/MOV in Crew Management before joining a new vessel.'
          );
        }
      }

      const vessel = await this.validateInviteCode(inviteCode);
      if (!vessel) throw new Error('Invalid invite code');
      const { error } = await supabase
        .from('users')
        .update({
          vessel_id: vessel.id,
          role: 'CREW',
          vessel_joined_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
      if (error) throw error;
      try {
        await vesselService.regenerateInviteCode(vessel.id);
        if (__DEV__) console.log('🔄 Invite code regenerated for next crew member');
      } catch (regenError) {
        if (__DEV__) console.error('⚠️ Failed to regenerate invite code (non-fatal):', regenError);
      }
      return await this.getUserProfile(userId);
    } catch (error: any) {
      const msg = error?.message?.toLowerCase() || '';
      const isInviteCodeError =
        msg.includes('invite code') ||
        msg.includes('vessel not found') ||
        msg.includes('cannot coerce') ||
        msg.includes('expired') ||
        msg.includes('crew limit');
      const isSoleCaptainError = msg.includes('only captain');
      if (!isInviteCodeError && !isSoleCaptainError && __DEV__) console.error('Join vessel error:', error);
      throw error;
    }
  }

  onAuthStateChange(callback: (user: User | null) => void) {
    return supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        if (event === 'TOKEN_REFRESHED' && !session) {
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } catch {
            /* best-effort */
          }
          callback(null);
          return;
        }
        if (session?.user) {
          const userData = await this.getUserProfileWithRetry(session.user.id);
          if (userData) {
            callback(userData);
          } else {
            if (__DEV__) {
              console.warn(
                '[Auth] Profile still unavailable after retries; keeping current session in UI if any.'
              );
            }
          }
        } else {
          callback(null);
        }
      } catch (error) {
        if (__DEV__) console.error('Auth state change handler error:', error);
        if (session?.user) return;
        callback(null);
      }
    });
  }
}

export default new AuthService();
