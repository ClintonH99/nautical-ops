import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as modernKeys from '../yachy-app/supabase/functions/_shared/modernSupabaseKeys.mjs';
const require = createRequire(new URL('../yachy-app/package.json', import.meta.url));
const ts = require('typescript');

function harness(slug, replacement) {
  let handler;
  const reads = [];
  const source = fs.readFileSync(new URL(`../yachy-app/supabase/functions/${slug}/index.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics.length, 0);
  vm.runInNewContext(compiled.outputText, {
    exports: {}, Response,
    Deno: { env: { get: name => { reads.push(name); return name === 'PADDLE_LIVE_WEBHOOK_V3_SECRET' ? replacement : 'retired-must-not-use'; } }, serve: fn => { handler = fn; } },
    require: name => {
      if (name.includes('modernSupabaseKeys')) return modernKeys;
      if (name.includes('supabase-js')) return { createClient: () => { throw new Error('No database operations'); } };
      if (name.includes('paddleLiveWebhook')) return { createPaddleLiveWebhookHandler: ({ getEnv }) => () => Response.json({ configured: getEnv('PADDLE_LIVE_WEBHOOK_V2_SECRET') === 'synthetic-replacement' }) };
      throw new Error('Unexpected import');
    },
  });
  return { handler, reads };
}
test('retired live endpoint always returns 410 without reading any credentials', async () => {
  const h = harness('paddle-live-webhook');
  assert.equal((await h.handler()).status, 410);
  assert.deepEqual(h.reads, []);
});
test('new endpoint reads only the fresh V3 secret', async () => {
  const h = harness('paddle-live-webhook-v3', 'synthetic-replacement');
  assert.deepEqual(await (await h.handler()).json(), { configured: true });
  assert.deepEqual(h.reads, ['PADDLE_LIVE_WEBHOOK_V3_SECRET']);
});
test('missing V3 secret never falls back to retired credentials', async () => {
  const h = harness('paddle-live-webhook-v3');
  assert.deepEqual(await (await h.handler()).json(), { configured: false });
  assert.deepEqual(h.reads, ['PADDLE_LIVE_WEBHOOK_V3_SECRET']);
});
