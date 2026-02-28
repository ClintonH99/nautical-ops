/**
 * Auth link service for QR code sign-in.
 * Links web session to app: web shows QR, app scans and claims.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const getFunctionsUrl = () => `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`;

export type CreateCodeResult = { code: string } | { error: string };
export type GetLinkResult = { status: 'pending' } | { action_link: string } | { error: string };
export type ClaimResult = { success: true } | { error: string };

export async function createAuthCode(): Promise<CreateCodeResult> {
  const url = `${getFunctionsUrl()}/create-auth-code`;
  const res = await fetch(url, { method: 'POST' });
  const json = await res.json();
  if (!res.ok) return { error: json.error || 'Failed to create code' };
  if (!json.code) return { error: 'No code returned' };
  return { code: json.code };
}

export async function getAuthLink(code: string): Promise<GetLinkResult> {
  const url = `${getFunctionsUrl()}/get-auth-link`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const json = await res.json();
  if (json.action_link) return { action_link: json.action_link };
  if (json.status === 'pending') return { status: 'pending' };
  return { error: json.error || 'Failed to get link' };
}

export async function claimAuthLink(code: string, accessToken: string): Promise<ClaimResult> {
  const url = `${getFunctionsUrl()}/claim-auth-link`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ code }),
  });
  const json = await res.json();
  if (res.ok && json.success) return { success: true };
  return { error: json.error || 'Failed to claim' };
}
