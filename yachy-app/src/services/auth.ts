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
import { registerCurrentDevice, releaseCurrentDevice } from './deviceAccess';
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
  role?: string;
}

const GOOGLE_WEB_CLIENT_ID =
  '85474399891-g61250m3f56fas70duo2flsvr7ud6dm3.apps.googleusercontent.com';
const GOOGLE_IOS_CLIENT_ID =
  '85474399891-q9i3vgnhc07n8nuqafcfj4a8om40a5nl.apps.googleusercontent.com';

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
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<null>(
          (_, reject) =>
            (timeoutId = setTimeout(
              () => reject(new Error('Profile load timed out. Please try again.')),
              PROFILE_TIMEOUT_MS
            ))
        );
        let userData: User | null;
        try {
          userData = await Promise.race([userDataPromise, timeoutPromise]);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
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
    // Native Google Sign-In on iOS/Android: the device returns an ID token
    // directly, so there is no browser hop, no callback URL and no iOS
    // "wants to use ... to sign in" system prompt. Web keeps the OAuth flow.
    if (Platform.OS !== 'web') {
      try {
        const { GoogleSignin } = require('@react-native-google-signin/google-signin');
        GoogleSignin.configure({
          webClientId: GOOGLE_WEB_CLIENT_ID,
          iosClientId: GOOGLE_IOS_CLIENT_ID,
        });
        await GoogleSignin.hasPlayServices();
        const result = await GoogleSignin.signIn();
        const idToken = result?.data?.idToken ?? result?.idToken;
        if (!idToken) return { user: null, session: null };
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });
        if (error) throw error;
        if (!data.user) return { user: null, session: null };
        const userData = await this.ensureOAuthUserProfile(data.user, null, true);
        if (!userData) {
          await supabase.auth.signOut();
          throw new Error('NO_ACCOUNT');
        }
        return { user: userData, session: data.session };
      } catch (error: any) {
        // Cancelling is not an error worth surfacing.
        if (error?.code === 'SIGN_IN_CANCELLED' || error?.code === '-5' || error?.code === 12501) {
          return { user: null, session: null };
        }
        if (__DEV__) console.error('Google sign in error:', error);
        throw error;
      }
    }

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
      const userData = await this.ensureOAuthUserProfile(sessionData.user, null, true);
      if (!userData) {
        await supabase.auth.signOut();
        throw new Error('NO_ACCOUNT');
      }
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
        const userData = await this.ensureOAuthUserProfile(sessionData.user, null, true);
        if (!userData) {
          await supabase.auth.signOut();
          throw new Error('NO_ACCOUNT');
        }
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
      const userData = await this.ensureOAuthUserProfile(data.user, credential.fullName, true);
      if (!userData) {
        await supabase.auth.signOut();
        throw new Error('NO_ACCOUNT');
      }
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
    } | null,
    existingOnly = false
  ): Promise<User | null> {
    const profile = await this.getUserProfile(authUser.id);
    if (profile) return profile;
    // Social sign-in is a faster way back in for people who already
    // registered - it must not mint an account with no role, department
    // or vessel. Callers pass existingOnly to enforce that.
    if (existingOnly) return null;
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
    role: explicitRole,
  }: RegisterData) {
    try {
      if (__DEV__) {
        console.log('🚀 Starting signup process...');
        console.log('📧 Email:', email);
        console.log('🎫 Invite Code:', inviteCode || 'None');
      }
      let validatedVessel: { id: string; name: string } | null = null;
      if (inviteCode && inviteCode.trim()) {
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
        const role = explicitRole === 'CAPTAIN_MOV' ? 'CAPTAIN_MOV' : 'CREW';
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
        if (__DEV__) console.log('💾 Creating unassigned user profile');
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

        const deviceAccess = await registerCurrentDevice();
        if (deviceAccess.state === 'limit_reached') {
          throw new Error('This account is already registered on 2 devices.');
        }

        if (validatedVessel) {
          await this.joinVessel(authData.user.id, inviteCode!);
        } else if (role === 'CREW') {
          // New crew without an invite receive a private solo workspace. The
          // server creates it and assigns membership in one transaction.
          await vesselService.createVessel({ name: 'Crew Account', isSolo: true });
        }

        const mappedUser = await this.getUserProfile(authData.user.id);
        if (!mappedUser) throw new Error('Account profile could not be loaded');
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

  /**
   * Step 1 of password reset: emails a 6-digit recovery code.
   * Relies on the Supabase "Reset Password" template outputting
   * {{ .Token }} rather than a confirmation link.
   */
  async sendPasswordResetCode(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
    if (error) throw error;
  }

  /**
   * Step 2: verifies the code. On success Supabase signs the user in,
   * which is what makes updatePassword() below possible.
   */
  async verifyPasswordResetCode(email: string, token: string): Promise<void> {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'recovery',
    });
    if (error) throw error;
  }

  /** Step 3: sets the new password. Only valid once step 2 has succeeded. */
  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  async signOut() {
    try {
      await releaseCurrentDevice();
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
    if (__DEV__) console.log('🔍 Validating invite code in database:', inviteCode);
    const { data, error } = await supabase.rpc('validate_vessel_invite_code', {
      p_invite_code: inviteCode.trim().toUpperCase(),
    });
    if (error) throw new Error(error.message || 'Invalid invite code');
    if (!data) throw new Error('Invalid invite code');
    if (__DEV__) console.log('✅ Vessel found:', data.name, 'ID:', data.id);
    return data as { id: string; name: string };
  }

  async joinVessel(userId: string, inviteCode: string) {
    try {
      const { error } = await supabase.rpc('join_current_user_to_vessel', {
        p_invite_code: inviteCode.trim().toUpperCase(),
      });
      if (error) throw error;
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
      if (!isInviteCodeError && !isSoleCaptainError && __DEV__)
        console.error('Join vessel error:', error);
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
