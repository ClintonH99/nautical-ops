/**
 * Claim an auth code with the app's session. Generates magic link and stores for web to pick up.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://www.nautical-ops.com',
  'https://nautical-ops.com',
  'https://nautical-ops.vercel.app',
];

function corsHeaders(req: Request, extra: Record<string, string> = {}): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allowed =
    ALLOWED_ORIGINS.includes(origin) ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:');
  const allowOrigin = allowed && origin ? origin : ALLOWED_ORIGINS[0];
  return { 'Access-Control-Allow-Origin': allowOrigin, ...extra };
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

/** Must match entries in Supabase → Authentication → URL Configuration → Redirect URLs (exact string). */
const DEFAULT_PRICING_REDIRECT = 'https://www.nautical-ops.com/pricing';
const ALLOWED_REDIRECT_TOS = [
  'https://www.nautical-ops.com/pricing',
  'https://nautical-ops.com/pricing',
  'https://nautical-ops.vercel.app/pricing',
];

function resolveRedirectTo(raw: string | undefined): string {
  const t = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
  if (t && ALLOWED_REDIRECT_TOS.includes(t)) return t;
  return DEFAULT_PRICING_REDIRECT;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(req, {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }),
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
    });
  }
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization' }), {
        status: 401,
        headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
      });
    }
    const token = authHeader.slice(7);
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user?.email) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
      });
    }
    const body = (await req.json()) as { code?: string; redirect_to?: string };
    const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!/^[A-HJ-NP-Z2-9]{12}$/.test(code)) {
      return new Response(JSON.stringify({ error: 'Invalid code' }), {
        status: 400,
        headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
      });
    }
    const redirectTo = resolveRedirectTo(body.redirect_to);
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
      options: { redirectTo },
    });
    if (linkError || !linkData?.properties?.action_link) {
      console.error('generateLink error:', linkError, 'redirectTo:', redirectTo);
      return new Response(JSON.stringify({ error: 'Failed to generate link' }), {
        status: 500,
        headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
      });
    }
    const actionLink = String(linkData.properties.action_link).trim();
    const { data: claimed, error: claimError } = await supabaseAdmin.rpc('admin_claim_auth_link', {
      p_code: code,
      p_action_link: actionLink,
    });
    if (claimError) throw claimError;
    if (!claimed) {
      return new Response(JSON.stringify({ error: 'Invalid, expired, or already claimed code' }), {
        status: 400,
        headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
      });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
    });
  } catch (e) {
    console.error('claim-auth-link:', e);
    return new Response(JSON.stringify({ error: 'Could not complete QR sign-in' }), {
      status: 500,
      headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
    });
  }
});
