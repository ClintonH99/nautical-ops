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
  const allowed =
    ALLOWED_ORIGINS.includes(origin) ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:');
  const allowOrigin = allowed && origin ? origin : ALLOWED_ORIGINS[0];
  return { 'Access-Control-Allow-Origin': allowOrigin, ...extra };
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(req, {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
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
    const body = (await req.json()) as { code?: string };
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!/^[A-HJ-NP-Z2-9]{12}$/.test(code)) {
      return new Response(JSON.stringify({ error: 'Invalid code' }), {
        status: 400,
        headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
      });
    }
    const { data, error } = await supabase.rpc('admin_consume_auth_link', { p_code: code });
    if (error) throw error;
    if (data?.status === 'pending') {
      return new Response(JSON.stringify({ status: 'pending' }), {
        status: 200,
        headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
      });
    }
    if (data?.status === 'expired') {
      return new Response(JSON.stringify({ error: 'Expired' }), {
        status: 400,
        headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
      });
    }
    if (data?.status !== 'ready' || typeof data.action_link !== 'string') {
      throw new Error('Unexpected auth-link response');
    }
    return new Response(JSON.stringify({ action_link: data.action_link }), {
      status: 200,
      headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
    });
  } catch (e) {
    console.error('get-auth-link:', e);
    return new Response(JSON.stringify({ error: 'Could not check sign-in status' }), {
      status: 500,
      headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
    });
  }
});
