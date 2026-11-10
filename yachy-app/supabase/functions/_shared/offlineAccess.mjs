const origins = new Set([
  'https://nautical-ops.com',
  'https://www.nautical-ops.com',
  'https://nautical-ops.vercel.app',
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encode = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
const json64 = (value) => encode(new TextEncoder().encode(JSON.stringify(value)));
export function createOfflineAccessHandler({ getEnv, createClient }) {
  return async (request) => {
    const origin = request.headers.get('origin');
    const configured = getEnv('WEB_OFFLINE_PREVIEW_ORIGIN');
    const allowed =
      origin &&
      (origins.has(origin) ||
        (origin === configured && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)));
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (!allowed) return reply(403, { error: 'Origin not allowed' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'POST required' });
    if (getEnv('WEB_OFFLINE_ENABLED') !== 'true')
      return reply(503, { error: 'Offline preparation unavailable' });
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) return reply(401, { error: 'Sign in required' });
    try {
      const raw = await request.text();
      if (raw.length > 2048) return reply(413, { error: 'Request too large' });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return reply(400, { error: 'Invalid request' });
      }
      if (!uuid.test(body?.vesselId ?? '') || !/^[a-f0-9]{64}$/.test(body?.deviceId ?? ''))
        return reply(400, { error: 'Invalid device or vessel' });
      const url = getEnv('SUPABASE_URL');
      const projectId = new URL(url).hostname.split('.')[0];
      const client = createClient(url, getEnv('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: auth, error: authError } = await client.auth.getUser();
      if (authError || !auth?.user) return reply(401, { error: 'Sign in required' });
      const { data: c, error } = await client.rpc('get_web_offline_context', {
        p_vessel_id: body.vesselId,
        p_device_id: body.deviceId,
      });
      if (error)
        return reply(error.code === '42501' ? 403 : 503, {
          error: 'Online access verification required',
        });
      if (
        !c ||
        c.userId !== auth.user.id ||
        c.vesselId !== body.vesselId ||
        c.deviceId !== body.deviceId ||
        !uuid.test(c.sessionId ?? '') ||
        ![c.iat, c.exp, c.accessUntil].every((n) => Number.isSafeInteger(n) && n > 0) ||
        c.exp <= c.iat ||
        c.exp - c.iat > 604800 ||
        c.accessUntil < c.exp
      ) {
        return reply(503, { error: 'Access verification unavailable' });
      }
      const permissions = {};
      for (const feature of ['notes', 'shoppingLists', 'tasks', 'contractors']) {
        const actions = c.permissions?.[feature];
        if (
          Array.isArray(actions) &&
          actions.length &&
          actions.every((action) => ['read', 'create', 'update'].includes(action))
        )
          permissions[feature] = actions;
      }
      if (!permissions.notes?.includes('read'))
        return reply(503, { error: 'Offline permissions unavailable' });
      const claims = {
        iss: `nautical-ops:${projectId}`,
        aud: origin,
        sub: c.userId,
        projectId,
        vesselId: c.vesselId,
        deviceId: c.deviceId,
        sessionId: c.sessionId,
        iat: c.iat,
        exp: c.exp,
        accessUntil: c.accessUntil,
        permissions,
      };
      const kid = getEnv('WEB_OFFLINE_SIGNING_KEY_ID');
      if (!kid || kid.length > 80) return reply(503, { error: 'Offline preparation unavailable' });
      const key = await crypto.subtle.importKey(
        'jwk',
        JSON.parse(getEnv('WEB_OFFLINE_SIGNING_JWK')),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
      );
      const input =
        json64({ alg: 'ES256', typ: 'nautical-ops-offline+jwt', kid }) + '.' + json64(claims);
      const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        new TextEncoder().encode(input)
      );
      return reply(200, { token: input + '.' + encode(new Uint8Array(signature)) });
    } catch {
      return reply(503, { error: 'Offline preparation temporarily unavailable' });
    }
  };
}
