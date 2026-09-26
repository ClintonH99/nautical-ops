/** @jest-environment node */
import { createReadTransport } from '../../src/services/readTransport';

const base = 'https://example.supabase.co';
const url = `${base}/rest/v1/notes?user_id=eq.one`;
const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('read transport', () => {
  it('respects cancellation even when a recent response is cached', async () => {
    const fetcher = jest.fn().mockResolvedValue(reply([]));
    const transport = createReadTransport(fetcher, base);
    await transport.fetch(url);
    const controller = new AbortController();
    controller.abort();
    await expect(transport.fetch(url, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('deduplicates concurrent reads and gives each consumer its own readable body', async () => {
    const network = deferred<Response>();
    const fetcher = jest.fn().mockReturnValue(network.promise);
    const transport = createReadTransport(fetcher, base);
    const first = transport.fetch(url);
    const second = transport.fetch(url);
    network.resolve(reply([{ id: 'one' }]));
    expect(await (await first).json()).toEqual([{ id: 'one' }]);
    expect(await (await second).json()).toEqual([{ id: 'one' }]);
    expect(await (await transport.fetch(url)).json()).toEqual([{ id: 'one' }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('separates authorization, query and representation headers', async () => {
    const fetcher = jest.fn().mockImplementation(async () => reply([]));
    const transport = createReadTransport(fetcher, base);
    await transport.fetch(url, { headers: { Authorization: 'Bearer one' } });
    await transport.fetch(url, { headers: { Authorization: 'Bearer two' } });
    await transport.fetch(url + '&limit=10', { headers: { Authorization: 'Bearer one' } });
    await transport.fetch(url, {
      headers: { Authorization: 'Bearer one', Accept: 'application/vnd.pgrst.object+json' },
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('never caches profile, vessel or subscription access reads', async () => {
    const fetcher = jest.fn().mockImplementation(async () => reply([]));
    const transport = createReadTransport(fetcher, base);
    for (const table of ['users', 'vessels', 'vessel_subscriptions', 'account_devices']) {
      await transport.fetch(`${base}/rest/v1/${table}`);
      await transport.fetch(`${base}/rest/v1/${table}`);
    }
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it('invalidates on both sides of a write, including reads overlapping the write', async () => {
    const oldRead = deferred<Response>();
    const write = deferred<Response>();
    const fetcher = jest
      .fn()
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(write.promise)
      .mockResolvedValueOnce(reply([{ id: 'new' }]));
    const transport = createReadTransport(fetcher, base);
    const first = transport.fetch(url);
    const saving = transport.fetch(url, { method: 'PATCH', body: '{}' });
    write.resolve(reply({ id: 'new' }));
    await saving;
    oldRead.resolve(reply([{ id: 'old' }]));
    await first;
    expect(await (await transport.fetch(url)).json()).toEqual([{ id: 'new' }]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('explicit refresh bypasses the recent response', async () => {
    const fetcher = jest.fn().mockImplementation(async () => reply([]));
    const transport = createReadTransport(fetcher, base);
    await transport.fetch(url);
    transport.invalidate();
    await transport.fetch(url);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('aborts a stalled read without retrying or duplicating a write', async () => {
    jest.useFakeTimers();
    const fetcher = jest.fn().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const transport = createReadTransport(fetcher, base, 10_000, 200);
    const pending = expect(transport.fetch(url)).rejects.toThrow('aborted');
    await jest.advanceTimersByTimeAsync(201);
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('does not cache errors and allows the next attempt to succeed', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(reply([]));
    const transport = createReadTransport(fetcher, base);
    expect((await transport.fetch(url)).status).toBe(503);
    expect((await transport.fetch(url)).status).toBe(200);
  });
});
