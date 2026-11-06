import { pathToFileURL } from 'node:url';

// Fixed sandbox target: never accept an environment variable, URL or CLI flag
// that could accidentally direct this check to production.
export const SANDBOX_PROJECT = 'qgttmqelxugnyzcutlgw';
export const WEBHOOK_URL = `https://${SANDBOX_PROJECT}.supabase.co/functions/v1/paddle-webhook`;

export async function checkConnection(fetcher = fetch) {
  try {
    const get = await fetcher(WEBHOOK_URL, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (get.body) await get.body.cancel();
    if (get.status === 410) return { ready: false, code: 'SANDBOX_MODE_NOT_CONFIGURED' };
    if (get.status !== 405) return { ready: false, code: 'ENDPOINT_UNAVAILABLE', httpStatus: get.status };
    // An unsigned empty request must be rejected before provider access or DB
    // writes. No key, customer, subscription or transaction is sent.
    const post = await fetcher(WEBHOOK_URL, {
      method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (post.body) await post.body.cancel();
    if (post.status !== 401) return { ready: false, code: 'UNSIGNED_REQUEST_NOT_REJECTED', httpStatus: post.status };
    return { ready: true, code: 'ENDPOINT_REACHABLE_UNSIGNED_REQUEST_REJECTED',
      paymentFlowVerified: false,
      note: 'This checks reachability only. Signed Paddle delivery and app access still require an end-to-end test.' };
  } catch {
    // Never print response bodies, environment values or raw exception data.
    return { ready: false, code: 'CONNECTION_FAILED',
      note: 'Check the sandbox project status; a free project may be paused. Do not switch live billing to sandbox.' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkConnection();
  console.log(JSON.stringify({ project: SANDBOX_PROJECT, ...result }, null, 2));
  if (!result.ready) process.exitCode = 1;
}
