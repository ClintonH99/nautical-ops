/**
 * Auth link service for QR code sign-in.
 * Links web session to app: web shows QR, app scans and claims.
 */

import { SUPABASE_URL, isSupabaseConfigured } from './supabase';

const getFunctionsUrl = () => `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`;

export type CreateCodeResult = { code: string } | { error: string };
export type GetLinkResult = { status: 'pending' } | { action_link: string } | { error: string };
export type ClaimResult = { success: true } | { error: string };

export async function createAuthCode(): Promise<CreateCodeResult> {
  if (!isSupabaseConfigured()) {
    return {
      error:
        'Supabase not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in Vercel → Settings → Environment Variables, then redeploy.',
    };
  }

  const url = `${getFunctionsUrl()}/create-auth-code`;
  try {
    const res = await fetch(url, { method: 'POST' });
    let json: any = {};
    try {
      json = await res.json();
    } catch {
      return {
        error: `Request failed (${res.status}). Ensure create-auth-code Edge Function is deployed: supabase functions deploy create-auth-code`,
      };
    }
    if (!res.ok) return { error: json.error || `Failed to create code (${res.status})` };
    if (!json.code) return { error: json.error || 'No code returned' };
    return { code: json.code };
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (msg.includes('fetch') || msg.includes('Network')) {
      return {
        error:
          'Network error. Check Vercel env: EXPO_PUBLIC_SUPABASE_URL must be set. Deploy Supabase Edge Functions: supabase functions deploy create-auth-code',
      };
    }
    return { error: msg || 'Failed to create code' };
  }
}

export async function getAuthLink(code: string): Promise<GetLinkResult> {
  if (!isSupabaseConfigured()) {
    return { error: 'Supabase not configured' };
  }
  const url = `${getFunctionsUrl()}/get-auth-link`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    let json: any = {};
    try {
      json = await res.json();
    } catch {
      return { error: `Request failed (${res.status}). Ensure get-auth-link Edge Function is deployed.` };
    }
    if (json.action_link) return { action_link: json.action_link };
    if (json.status === 'pending') return { status: 'pending' };
    return { error: json.error || 'Failed to get link' };
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (msg.includes('fetch') || msg.includes('Network')) {
      return { error: 'Network error while checking for scan.' };
    }
    return { error: msg || 'Failed to get link' };
  }
}

export async function claimAuthLink(
  code: string,
  accessToken: string,
  redirectTo?: string
): Promise<ClaimResult> {
  if (!isSupabaseConfigured()) {
    return { error: 'Supabase not configured' };
  }
  const url = `${getFunctionsUrl()}/claim-auth-link`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ code, redirect_to: redirectTo || undefined }),
    });
    let json: any = {};
    try {
      json = await res.json();
    } catch {
      return { error: `Request failed (${res.status}). Ensure claim-auth-link Edge Function is deployed.` };
    }
    if (res.ok && json.success) return { success: true };
    return { error: json.error || 'Failed to claim' };
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (msg.includes('fetch') || msg.includes('Network')) {
      return { error: 'Network error. Check connection and try again.' };
    }
    return { error: msg || 'Failed to claim' };
  }
}
