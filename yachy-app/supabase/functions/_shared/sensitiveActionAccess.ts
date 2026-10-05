/** Authorize using the CALLER token, never a service-role database context. */
type AccessConfig = {
  url: string | undefined;
  anonKey: string | undefined;
  fetcher?: typeof fetch;
};

type AccessResult =
  | { allowed: true; userId: string }
  | { allowed: false; response: Response };

function reject(status: number, error: string): AccessResult {
  return {
    allowed: false,
    response: new Response(JSON.stringify({ error }), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }),
  };
}

export async function authorizeSensitiveAction(
  request: Request,
  { url, anonKey, fetcher = fetch }: AccessConfig
): Promise<AccessResult> {
  const authorization = request.headers.get('Authorization');
  if (!authorization || !/^Bearer \S+$/i.test(authorization)) {
    return reject(401, 'Unauthorized');
  }
  if (!url || !anonKey) return reject(503, 'Account verification is temporarily unavailable. Please try again.');

  const headers = { Authorization: authorization, apikey: anonKey, 'Content-Type': 'application/json' };
  const unavailable = () => reject(503, 'Account verification is temporarily unavailable. Please try again.');
  try {
    const userResponse = await fetcher(`${url}/auth/v1/user`, {
      headers, signal: AbortSignal.timeout(8000),
    });
    if (userResponse.status === 401 || userResponse.status === 403) return reject(401, 'Unauthorized');
    if (!userResponse.ok) return unavailable();
    const user = await userResponse.json();
    if (!user || typeof user.id !== 'string' || !user.id) return reject(401, 'Unauthorized');

    const deviceResponse = await fetcher(`${url}/rest/v1/rpc/current_session_has_registered_device`, {
      method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(8000),
    });
    if (deviceResponse.status === 401) return reject(401, 'Unauthorized');
    if (!deviceResponse.ok) return unavailable();
    const approved = await deviceResponse.json();
    if (approved === false) {
      return reject(403, 'This session is not registered on an approved device. Sign in again on an approved device, or contact support@nautical-ops.com.');
    }
    // Null, malformed or unexpected responses must never allow service actions.
    if (approved !== true) return unavailable();
    return { allowed: true, userId: user.id };
  } catch {
    // Do not expose upstream payloads, credentials or provider internals.
    return unavailable();
  }
}
