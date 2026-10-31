import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as modernKeys from '../yachy-app/supabase/functions/_shared/modernSupabaseKeys.mjs';
const require = createRequire(new URL('../yachy-app/package.json', import.meta.url));
const ts = require('typescript');
const source = fs.readFileSync(new URL('../yachy-app/supabase/functions/paddle-webhook/index.ts', import.meta.url), 'utf8');

for (const environment of ['live', 'sandbox', undefined]) {
  test(`legacy endpoint accepts only sandbox: ${environment}`, async () => {
    let handler;
    let delegated = 0;
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
    assert.equal(compiled.diagnostics.length, 0);
    vm.runInNewContext(compiled.outputText, {
      exports: {}, Response,
      Deno: { env: { get: name => name === 'PADDLE_ENV' ? environment : undefined }, serve: value => { handler = value; } },
      require: name => {
        if (name.includes('modernSupabaseKeys')) return modernKeys;
        if (name.includes('supabase-js')) return { createClient: () => { throw new Error('No database access allowed'); } };
        if (name.includes('paddleWebhook')) return { createPaddleWebhookHandler: () => () => { delegated++; return new Response(null, { status: 401 }); } };
        throw new Error('Unexpected import');
      },
    });
    const response = await handler(new Request('https://synthetic.invalid', { method: 'POST', body: '{}' }));
    assert.equal(response.status, environment === 'sandbox' ? 401 : 410);
    assert.equal(delegated, environment === 'sandbox' ? 1 : 0);
  });
}
