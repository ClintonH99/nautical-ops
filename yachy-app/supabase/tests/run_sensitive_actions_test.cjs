// Execute the real Edge handlers with isolated Auth/REST/storage transports.
// No requests reach Supabase and no accounts or files can be deleted.
/* global Request, Response */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../functions');
let checks = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };

function loadHandler(name, scenario) {
  const effects = [];
  const requests = [];
  let handler;
  const service = {
    rpc: async (method, args) => {
      effects.push([method, args]);
      return scenario.businessError
        ? { data: null, error: { message: scenario.businessError } }
        : { data: { deleted_vessel_id: 'test-vessel', cancellation_provider: null }, error: null };
    },
    auth: { admin: { deleteUser: async (id) => { effects.push(['deleteUser', id]); return {}; } } },
    storage: { from: (bucket) => ({
      list: async (id) => { effects.push(['storage.list', bucket, id]); return { data: [{ name: 'test' }] }; },
      remove: async (paths) => { effects.push(['storage.remove', bucket, paths]); return {}; },
    }) },
  };
  const env = { SUPABASE_URL:'https://test.invalid', SUPABASE_ANON_KEY:'public-test-key', SUPABASE_SERVICE_ROLE_KEY:'private-test-key' };
  const fetcher = async (url, options) => {
    requests.push([url, options]);
    if (scenario.throwAt && requests.length === scenario.throwAt) throw new Error('private-provider-detail');
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify(scenario.user ?? { id: 'verified-user' }), { status:scenario.authStatus ?? 200 });
    if (url.endsWith('/rpc/current_session_has_registered_device')) {
      return new Response(scenario.malformed ? 'not JSON' : JSON.stringify('approval' in scenario ? scenario.approval : true), { status:scenario.deviceStatus ?? 200 });
    }
    throw new Error('Unexpected test transport: '+url);
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const out = {};
    cache.set(file, out);
    const code = ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 } }).outputText;
    const requireMock = (id) => {
      if (id === 'npm:@supabase/supabase-js@2') return { createClient:() => service };
      if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id));
      throw new Error('Unexpected test dependency: '+id);
    };
    new Function('exports','require','Deno','fetch',code)(out, requireMock,
      { env:{ get:(key) => env[key] }, serve:(fn) => { handler=fn; } }, fetcher);
    return out;
  }
  load(path.join(root,name,'index.ts'));
  return { handler, effects, requests };
}

(async () => {
  for (const name of ['leave-vessel','delete-account','delete-vessel']) {
    for (const [scenario, status] of [
      [{ noToken:true },401], [{ authStatus:401 },401], [{ authStatus:503 },503],
      [{ user:{} },401], [{ approval:false },403], [{ approval:null },503],
      [{ approval:'true' },503], [{ approval:{ allowed:true } },503],
      [{ deviceStatus:401 },401], [{ deviceStatus:500 },503], [{ malformed:true },503],
      [{ throwAt:1 },503], [{ throwAt:2 },503],
    ]) {
      const test = loadHandler(name,scenario);
      const result = await test.handler(new Request('https://test.invalid/'+name, {
        method:'POST', headers: scenario.noToken ? {} : { Authorization:'Bearer user-session' },
        body:JSON.stringify({ user_id:'forged-other-user' }),
      }));
      equal(result.status,status);
      equal(test.effects,[]);
      assert.doesNotMatch(await result.text(), /private-provider-detail|private-test-key/); checks++;
    }
    const allowed = loadHandler(name,{});
    const response = await allowed.handler(new Request('https://test.invalid/'+name, {
      method:'POST', headers:{ Authorization:'Bearer user-session', Origin:'https://nautical-ops.com' },
      body:JSON.stringify({ user_id:'forged-other-user' }),
    }));
    equal(response.status,200);
    equal(response.headers.get('Access-Control-Allow-Origin'),'https://nautical-ops.com');
    equal(allowed.effects[0][1],{ p_user_id:'verified-user' });
    for (const [,options] of allowed.requests) {
      equal(options.headers.Authorization,'Bearer user-session');
      equal(options.headers.apikey,'public-test-key');
    }
    if (name === 'delete-account') equal(allowed.effects[1],['deleteUser','verified-user']);
    if (name === 'delete-vessel') equal(allowed.effects.length,5);
    for (const [method,origin,status] of [['OPTIONS','https://nautical-ops.com',204],['GET','https://nautical-ops.com',405],['POST','https://hostile.invalid',403]]) {
      const test=loadHandler(name,{});
      equal((await test.handler(new Request('https://test.invalid/'+name,{method,headers:{Origin:origin}}))).status,status);
      equal(test.effects,[]);
      equal(test.requests,[]);
    }
    const conflict = loadHandler(name,{businessError:name==='delete-vessel' ? 'Only the Captain/MOV may delete this vessel' : 'You are the only Captain/MOV'});
    equal((await conflict.handler(new Request('https://test.invalid/'+name,{method:'POST',headers:{Authorization:'Bearer user-session'}}))).status,
      name==='leave-vessel'?400:name==='delete-account'?409:403);
    equal(conflict.effects.length,1);
  }
  console.log(`${checks} sensitive-action handler assertions passed; real handlers, mocked transports, no production requests.`);
})().catch(error => { console.error(error); process.exitCode=1; });
