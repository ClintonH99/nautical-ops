// Runs the exact proposed deployment bundles with synthetic keys and no network.
// Usage: node server/verify-edge-key-recovery.mjs /path/to/recovery-bundles.json
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../yachy-app/package.json', import.meta.url));
const ts = require('typescript');
const bundles = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const prices = Object.fromEntries(['1_5','6_10','11_15','16_25','26_40','40_plus'].map((tier,i) => [tier,
  Object.fromEntries(['monthly','3_months','6_months','12_months'].map((period,j) => [period, `pri_${String(i*4+j).padStart(26,'0')}`]))]));
let checks = 0;
for (const bundle of bundles) {
  for (const bearer of [false, true, 'revoked-admin', 'sb_secret_synthetic_only']) {
    let handler;
    const calls = { writes: 0, external: 0, auth: 0 };
    const env = {
      SUPABASE_URL: 'https://synthetic.invalid',
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_synthetic_only' }),
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_synthetic_only' }),
      SUPABASE_ANON_KEY: 'revoked-public', SUPABASE_SERVICE_ROLE_KEY: 'revoked-admin',
      PADDLE_ENV: 'sandbox', PADDLE_SANDBOX_TRIAL_ENABLED: 'true',
      PADDLE_PRICE_PREVIEW_ENABLED: 'true', PADDLE_CHECKOUT_ENABLED: 'true',
      PADDLE_SUBSCRIPTION_MANAGEMENT_ENABLED: 'true',
      PADDLE_LIVE_BILLING_ENABLED: 'false', PADDLE_SANDBOX_API_KEY: 'synthetic-only',
      PADDLE_PRICE_IDS: JSON.stringify(prices), PADDLE_CHECKOUT_URL: 'https://www.nautical-ops.com/checkout',
      PADDLE_WEBHOOK_SECRET: 'synthetic-webhook', PADDLE_LIVE_WEBHOOK_V2_SECRET: 'synthetic-replacement',
      APPLE_NOTIFICATION_WEBHOOK_TOKEN: 'synthetic-apple',
    };
    const forbidden = () => { calls.writes++; throw new Error('Unexpected privileged operation'); };
    const client = {
      auth: { getUser: async () => { calls.auth++; return { data: { user: null }, error: { message: 'Invalid test session' } }; }, admin: { generateLink: forbidden, deleteUser: forbidden } },
      from: forbidden, rpc: forbidden, storage: { from: forbidden },
    };
    const cache = new Map();
    const files = new Map(bundle.files.map(f => [f.name, f.content]));
    function load(name) {
      if (cache.has(name)) return cache.get(name).exports;
      assert.ok(files.has(name), `Missing dependency ${name}`);
      const result = ts.transpileModule(files.get(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true }, fileName: name.replace(/\.mjs$/, '.ts'), reportDiagnostics: true });
      assert.equal(result.diagnostics.length, 0, `Compilation: ${name}`);
      const module = { exports: {} }; cache.set(name, module);
      vm.runInNewContext(result.outputText, {
        module, exports: module.exports, Request, Response, Headers, URL, TextEncoder, TextDecoder,
        crypto, Uint8Array, AbortController, AbortSignal, setTimeout, clearTimeout,
        console: { error() {}, warn() {}, log() {} },
        Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } },
        fetch: async url => {
          if (String(url) === 'https://synthetic.invalid/auth/v1/user') {
            calls.auth++; return Response.json({ error: 'Invalid test session' }, { status: 401 });
          }
          calls.external++; throw new Error('Network forbidden');
        },
        require: spec => {
          if (spec.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(name), spec)));
          if (spec === 'npm:@supabase/supabase-js@2') return { createClient: (_url,key,options) => {
            assert.ok(['sb_secret_synthetic_only','sb_publishable_synthetic_only'].includes(key), 'Must use replacement key');
            if (options?.global?.headers?.Authorization) assert.equal(options.global.headers.Authorization, `Bearer ${bearer === true ? 'synthetic-invalid-user-token' : bearer}`);
            return client;
          } };
          if (spec === 'npm:jose@5') return { SignJWT: class {}, importPKCS8: forbidden, decodeJwt: forbidden };
          if (spec === 'npm:resend@4') return { Resend: class { emails = { send: forbidden }; } };
          throw new Error(`Unreviewed import ${spec}`);
        },
      }, { filename: name });
      return module.exports;
    }
    load(bundle.entrypoint_path);
    assert.equal(typeof handler, 'function');
    const response = await handler(new Request(`https://synthetic.invalid/${bundle.name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer === true ? 'synthetic-invalid-user-token' : bearer}` } : {}) }, body: '{}',
    }));
    assert.equal(response.status, 401, `${bundle.name}: ${bearer ? 'invalid session' : 'anonymous'} must be denied`);
    assert.equal(calls.writes, 0); assert.equal(calls.external, 0);
    checks++;
  }
  console.log(`PASS ${bundle.name}: anonymous and forged-session requests denied without privileged operations`);
}
console.log(`${checks} exact-bundle authentication checks passed; no external requests made.`);
