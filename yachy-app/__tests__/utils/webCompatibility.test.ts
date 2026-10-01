import { withBrowserCors } from '../../supabase/functions/_shared/browserCors';

describe('browser account-action transport', () => {
  const origin = 'https://nautical-ops.com';
  test('preflight succeeds without running the protected operation', async () => {
    const operation = jest.fn();
    const response = await withBrowserCors(operation)(
      new Request('https://test.invalid', {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'POST' },
      })
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-headers')).toContain('apikey');
    expect(operation).not.toHaveBeenCalled();
  });
  test('untrusted origins cannot invoke the operation', async () => {
    const operation = jest.fn();
    const response = await withBrowserCors(operation)(
      new Request('https://test.invalid', {
        method: 'POST',
        headers: { origin: 'https://untrusted.invalid' },
      })
    );
    expect(response.status).toBe(403);
    expect(operation).not.toHaveBeenCalled();
  });
  test('preserves authentication failure and its JSON with browser headers', async () => {
    const operation = jest.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Invalid session' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    const response = await withBrowserCors(operation)(
      new Request('https://test.invalid', { method: 'POST', headers: { origin } })
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(await response.json()).toEqual({ error: 'Invalid session' });
  });
});
