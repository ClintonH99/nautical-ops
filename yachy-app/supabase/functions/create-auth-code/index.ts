/**
 * Create a one-time auth code for QR sign-in.
 * Web calls this, gets a code, displays as QR. User scans with app to claim.
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

// Simple in-memory rate limit: max 10 code creations per minute per key (IP or origin)
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitMap = new Map<string, number[]>();

function getRateLimitKey(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('cf-connecting-ip')
    || req.headers.get('Origin')
    || 'unknown';
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  let timestamps = rateLimitMap.get(key) || [];
  timestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX) return true;
  timestamps.push(now);
  rateLimitMap.set(key, timestamps);
  return false;
}

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }) });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders(req, { 'Content-Type': 'application/json' }) });
  }
  const rateKey = getRateLimitKey(req);
  if (isRateLimited(rateKey)) {
    return new Response(JSON.stringify({ error: 'Too many requests. Try again in a minute.' }), {
      status: 429,
      headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
    });
  }
  try {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);
    let code = randomCode();
    let attempts = 0;
    while (attempts < 5) {
      const { error } = await supabase.from('auth_links').insert({ code, expires_at: expiresAt.toISOString() });
      if (!error) break;
      if (error.code === '23505') {
        code = randomCode();
        attempts++;
      } else throw error;
    }
    return new Response(JSON.stringify({ code }), {
      status: 200,
      headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
    });
  } catch (e) {
    console.error('create-auth-code:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: corsHeaders(req, { 'Content-Type': 'application/json' }),
    });
  }
});
