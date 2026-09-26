/** Short-lived GET deduplication. Writes and access checks always reach the server. */
export function createReadTransport(
  fetcher: typeof fetch,
  baseUrl: string,
  ttl = 10_000,
  timeout = 15_000
) {
  const cache = new Map<string, { response: Response; at: number }>();
  const pending = new Map<string, Promise<Response>>();
  let revision = 0;
  let writes = 0;
  const invalidate = () => {
    revision += 1;
    cache.clear();
    pending.clear();
  };
  const request: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (
      init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
    ).toUpperCase();
    const isRest = url.startsWith(`${baseUrl}/rest/v1/`);
    if (method !== 'GET' && method !== 'HEAD') {
      invalidate();
      writes += 1;
      try {
        return await fetcher(input, init);
      } finally {
        writes -= 1;
        invalidate();
      }
    }
    if (!isRest) return fetcher(input, init);
    const headers = new Headers(
      typeof input === 'object' && 'headers' in input ? input.headers : undefined
    );
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const table = url.slice(`${baseUrl}/rest/v1/`.length).split(/[/?]/)[0];
    const cacheable = !writes && !/^(users|vessels|.*subscription.*|.*device.*|rpc)$/.test(table);
    const key = JSON.stringify([url, method, Array.from(headers.entries()).sort()]);
    const signal =
      init?.signal ?? (typeof input === 'object' && 'signal' in input ? input.signal : undefined);
    if (signal?.aborted) {
      const error = new Error('The request was aborted');
      error.name = 'AbortError';
      throw error;
    }
    const cached = cache.get(key);
    if (cacheable && cached && Date.now() - cached.at < ttl) return cached.response.clone();
    if (cacheable && !signal && pending.has(key)) return (await pending.get(key)!).clone();
    const startedAtRevision = revision;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeout);
    const operation = (async () => {
      try {
        const response = await fetcher(input, { ...init, signal: controller.signal });
        if (cacheable && response.ok && startedAtRevision === revision && !writes) {
          cache.set(key, { response: response.clone(), at: Date.now() });
          if (cache.size > 100) cache.delete(cache.keys().next().value!);
        }
        return response;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    })();
    if (cacheable && !signal) pending.set(key, operation);
    try {
      return (await operation).clone();
    } finally {
      if (pending.get(key) === operation) pending.delete(key);
    }
  };
  return { fetch: request, invalidate };
}
