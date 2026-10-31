import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as modernKeys from '../yachy-app/supabase/functions/_shared/modernSupabaseKeys.mjs';
const require = createRequire(new URL('../yachy-app/package.json', import.meta.url));
const ts = require('typescript');

function harness(name, configured = true) {
  const calls = [];
  let handler;
  const source = fs.readFileSync(new URL(`../yachy-app/supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal(result.diagnostics.length, 0);
  const context = {
    exports: {}, Request, Response, crypto, Uint8Array, Map,
    console: { error() {} },
    Deno: {
      env: { get: key => ({ SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SECRET_KEYS: configured ? JSON.stringify({ default: 'sb_secret_synthetic_only' }) : undefined, SUPABASE_SERVICE_ROLE_KEY: 'revoked-do-not-use' })[key] },
      serve: fn => { handler = fn; },
    },
    require: name => {
      if (name.includes('modernSupabaseKeys')) return modernKeys;
      if (name.includes('supabase-js')) return { createClient: (url, key) => {
        assert.equal(key, 'sb_secret_synthetic_only'); calls.push('client');
        return {
          from: table => ({ insert: async row => {
            assert.equal(table, 'auth_links');
            assert.match(row.code, /^[A-HJ-NP-Z2-9]{12}$/);
            assert.ok(Date.parse(row.expires_at) > Date.now());
            calls.push('insert'); return { error: null };
          } }),
          rpc: async (name, args) => {
            assert.equal(name, 'admin_consume_auth_link');
            assert.equal(args.p_code, 'AAAAAAAAAAAA');
            calls.push('rpc'); return { data: { status: 'pending' }, error: null };
          },
        };
      } };
      throw new Error('Unexpected import');
    },
  };
  vm.runInNewContext(result.outputText, context);
  return { handler, calls };
}
const request = body => new Request('https://synthetic.invalid', { method: 'POST', body: JSON.stringify(body) });
test('QR generation uses replacement key and preserves code format', async () => {
  const h = harness('create-auth-code'); const res = await h.handler(request({}));
  assert.equal(res.status, 200); assert.match((await res.json()).code, /^[A-HJ-NP-Z2-9]{12}$/);
  assert.deepEqual(h.calls, ['client', 'insert']);
});
test('QR polling preserves pending response and original RPC', async () => {
  const h = harness('get-auth-link'); const res = await h.handler(request({ code: 'AAAAAAAAAAAA' }));
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { status: 'pending' });
  assert.deepEqual(h.calls, ['client', 'rpc']);
});
test('QR endpoints reject malformed requests without database access', async () => {
  for (const name of ['create-auth-code', 'get-auth-link']) {
    const h = harness(name); assert.equal((await h.handler(new Request('https://synthetic.invalid'))).status, 405);
    assert.deepEqual(h.calls, []);
  }
  const h = harness('get-auth-link'); assert.equal((await h.handler(request({ code: 'invalid' }))).status, 400);
  assert.deepEqual(h.calls, []);
});
test('missing replacement keys fail safely and never use revoked keys', async () => {
  for (const name of ['create-auth-code', 'get-auth-link']) {
    const h = harness(name, false); const res = await h.handler(request({ code: 'AAAAAAAAAAAA' }));
    assert.equal(res.status, 500); assert.doesNotMatch(await res.text(), /sb_secret|revoked|SUPABASE/);
    assert.deepEqual(h.calls, []);
  }
});
