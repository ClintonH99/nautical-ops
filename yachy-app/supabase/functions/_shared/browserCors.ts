/** Browser transport only. Authentication and authorization remain in each handler. */
const ALLOWED_ORIGINS = new Set([
  'https://nautical-ops.com',
  'https://www.nautical-ops.com',
  'https://nautical-ops.vercel.app',
]);

export function withBrowserCors(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return new Response('Origin not allowed', { status: 403 });
    }
    const headers = new Headers({
      Vary: 'Origin',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Max-Age': '600',
    });
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      const method = request.headers.get('access-control-request-method');
      if (method && method !== 'POST') return new Response(null, { status: 405, headers });
      return new Response(null, { status: 204, headers });
    }
    const response = await handler(request);
    const combined = new Headers(response.headers);
    headers.forEach((value, name) => combined.set(name, value));
    return new Response(response.body, { status: response.status, headers: combined });
  };
}
