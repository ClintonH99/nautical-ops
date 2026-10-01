import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { appleRenewalStatus } from '../../supabase/functions/_shared/appleRenewal';

// Exercise the actual Edge Function handler without network calls or credentials.
function handlerFixture(
  overrides: { role?: string; state?: number; renewal?: number; failure?: boolean } = {}
) {
  const rpc = jest.fn().mockResolvedValue({ error: null });
  const fetch = jest
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ signedTransactionInfo: 'authenticated-transaction' }),
    });
  const productId = 'com.nauticalops.app.crew_11_15_v2.monthly';
  const transaction = {
    bundleId: 'com.nauticalops.app',
    productId,
    originalTransactionId: 'original',
    transactionId: 'latest',
    purchaseDate: Date.now() - 1000,
    expiresDate: Date.now() + 60000,
  };
  if (overrides.state === 2) transaction.expiresDate = Date.now() - 1;
  const current = jest.fn().mockImplementation(async () => {
    if (overrides.failure) throw new Error('Apple unavailable');
    return {
      status: overrides.state ?? 1,
      transaction,
      renewal: { autoRenewStatus: overrides.renewal ?? 0 },
    };
  });
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'captain' } } }) },
    rpc,
    from: (table: string) => {
      const query: any = {
        select: () => query,
        eq: () => query,
        single: async () => ({
          data: { vessel_id: 'vessel', role: overrides.role ?? 'CAPTAIN_MOV' },
        }),
        maybeSingle: async () => ({
          data:
            table === 'vessel_subscriptions'
              ? {
                  vessel_id: 'vessel',
                  apple_latest_transaction_id: 'stored-transaction',
                  apple_original_transaction_id: 'original',
                }
              : null,
        }),
      };
      return query;
    },
  };
  class JWT {
    setProtectedHeader() {
      return this;
    }
    setIssuer() {
      return this;
    }
    setIssuedAt() {
      return this;
    }
    setExpirationTime() {
      return this;
    }
    setAudience() {
      return this;
    }
    async sign() {
      return 'test-jwt';
    }
  }
  class TestResponse {
    status: number;
    constructor(
      private body: string,
      options?: { status?: number }
    ) {
      this.status = options?.status ?? 200;
    }
    async json() {
      return JSON.parse(this.body);
    }
  }
  let handler: any;
  const source = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/verify-apple-iap/index.ts'),
    'utf8'
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('require', 'exports', 'Deno', 'fetch', 'Response', compiled)(
    (name: string) => {
      if (name.includes('supabase-js')) return { createClient: () => supabase };
      if (name.includes('jose'))
        return { SignJWT: JWT, importPKCS8: async () => ({}), decodeJwt: () => transaction };
      if (name.includes('appleStatus')) return { fetchCurrentAppleStatus: current };
      if (name.includes('appleRenewal')) return { appleRenewalStatus };
      throw new Error(name);
    },
    {},
    {
      env: { get: () => 'test' },
      serve: (fn: any) => {
        handler = fn;
      },
    },
    fetch,
    TestResponse
  );
  const request = (body: any) =>
    handler({ method: 'POST', headers: { get: () => 'Bearer test' }, json: async () => body });
  return { rpc, fetch, current, request };
}

it('refreshes the server-bound transaction and saves auto-renew off without ending paid access', async () => {
  const f = handlerFixture();
  const response = await f.request({
    vesselId: 'vessel',
    refreshOnly: true,
    transactionId: 'untrusted',
  });
  expect(response.status).toBe(200);
  expect(f.fetch.mock.calls[0][0]).toContain('/stored-transaction');
  expect(f.rpc).toHaveBeenCalledWith(
    'admin_record_apple_subscription',
    expect.objectContaining({
      p_status: 'canceled',
      p_vessel_id: 'vessel',
      p_latest_transaction_id: 'latest',
    })
  );
});

it('cannot reactivate cancelled renewal when the existing purchase is redelivered', async () => {
  const f = handlerFixture();
  expect((await f.request({ vesselId: 'vessel', transactionId: 'redelivered' })).status).toBe(200);
  expect(f.rpc.mock.calls[0][1].p_status).toBe('canceled');
});

it('refreshes expired state but does not activate an expired purchase', async () => {
  const f = handlerFixture({ state: 2 });
  expect((await f.request({ vesselId: 'vessel', refreshOnly: true })).status).toBe(200);
  f.rpc.mockClear();
  expect((await f.request({ vesselId: 'vessel', transactionId: 'expired' })).status).toBe(409);
  expect(f.rpc).not.toHaveBeenCalled();
});

it.each(['CREW', 'HOD'])(
  'rejects %s callers before querying Apple or mutating subscription data',
  async (role) => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const f = handlerFixture({ role });
    expect((await f.request({ vesselId: 'vessel', refreshOnly: true })).status).toBe(403);
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
    log.mockRestore();
  }
);

it('does not overwrite confirmed state if Apple cannot verify renewal', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const f = handlerFixture({ failure: true });
  expect((await f.request({ vesselId: 'vessel', refreshOnly: true })).status).toBe(500);
  expect(f.rpc).not.toHaveBeenCalled();
  log.mockRestore();
});
