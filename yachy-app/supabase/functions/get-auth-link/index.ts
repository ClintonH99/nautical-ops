/**
 * Get the action link for a code (web polls this). One-time use - deletes after.
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

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }) });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders(req, { 'Content-Type': 'application/json' }) });
  }
  try {
    const { code } = (await req.json()) as { code?: string };
    if (!code || typeof code !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing code' }), { status: 400, headers: corsHeaders(req, { 'Content-Type': 'application/json' }) });
    }
    const { data: row } = await supabase.from('auth_links').select('action_link, expires_at').eq('code', code).single();
    if (!row || !row.action_link) {
      return new Response(JSON.stringify({ status: 'pending' }), {
        status: 200,
        headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
      });
    }
    if (new Date(row.expires_at) < new Date()) {
      await supabase.from('auth_links').delete().eq('code', code);
      return new Response(JSON.stringify({ error: 'Expired' }), { status: 400, headers: corsHeaders(req, { 'Content-Type': 'application/json' }) });
    }
    await supabase.from('auth_links').delete().eq('code', code);
    return new Response(JSON.stringify({ action_link: row.action_link }), {
      status: 200,
      headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
    });
  } catch (e) {
    console.error('get-auth-link:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
    });
  }
});
