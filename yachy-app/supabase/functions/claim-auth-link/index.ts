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
  const allowed = ALLOWED_ORIGINS.includes(origin)
    || (origin.endsWith('.vercel.app') && origin.startsWith('https://'))
    || (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'));
  const allowOrigin = allowed && origin ? origin : ALLOWED_ORIGINS[0];
  return { 'Access-Control-Allow-Origin': allowOrigin, ...extra };
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }) });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders(req, { 'Content-Type': 'application/json' }) });
  }
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization' }), { status: 401, headers: corsHeaders(req, { 'Content-Type': 'application/json' }) });
    }
    const token = authHeader.slice(7);
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user?.email) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    const body = (await req.json()) as { code?: string; redirect_to?: string };
    const code = body?.code;
    if (!code || typeof code !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing code' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    const redirectTo = typeof body.redirect_to === 'string' && body.redirect_to
      ? body.redirect_to
      : 'https://www.nautical-ops.com';
    const { data: row } = await supabaseAdmin.from('auth_links').select('expires_at').eq('code', code).single();
    if (!row) {
      return new Response(JSON.stringify({ error: 'Invalid or expired code' }), { status: 400, headers: corsHeaders(req, { 'Content-Type': 'application/json' }) });
    }
    if (new Date(row.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: 'Code expired' }), { status: 400, headers: corsHeaders(req, { 'Content-Type': 'application/json' }) });
    }
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
      options: { redirectTo },
    });
    if (linkError || !linkData?.properties?.action_link) {
      console.error('generateLink error:', linkError);
      return new Response(JSON.stringify({ error: 'Failed to generate link' }), { status: 500, headers: corsHeaders(req, { 'Content-Type': 'application/json' }) });
    }
    await supabaseAdmin.from('auth_links').update({ action_link: linkData.properties.action_link }).eq('code', code);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
    });
  } catch (e) {
    console.error('claim-auth-link:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
    });
  }
});
