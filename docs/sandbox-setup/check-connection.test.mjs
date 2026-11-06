import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConnection, WEBHOOK_URL } from './check-connection.mjs';

test('checks only the fixed sandbox and rejects unsigned events', async () => {
  const calls=[];
  const result=await checkConnection(async (url,options)=>{
    calls.push({url,options});
    return new Response(null,{status: options.method==='GET'?405:401});
  });
  assert.equal(result.ready,true);
  assert.equal(result.paymentFlowVerified,false);
  assert.equal(calls.length,2);
  assert.ok(calls.every(c=>c.url===WEBHOOK_URL && c.options.redirect==='error'));
  assert.equal(calls[1].options.body,'{}');
  assert.equal(calls[1].options.headers.Authorization,undefined);
});

test('unconfigured mode stops before POST',async()=>{
  let calls=0;
  const result=await checkConnection(async()=>{calls++;return new Response(null,{status:410});});
  assert.equal(result.code,'SANDBOX_MODE_NOT_CONFIGURED');assert.equal(calls,1);
});

for(const status of [200,301,404,503]) test(`unexpected GET ${status} fails closed`,async()=>{
  const result=await checkConnection(async()=>new Response(null,{status}));
  assert.equal(result.ready,false);assert.equal(result.httpStatus,status);
});

test('accepted unsigned POST fails the check',async()=>{
  const result=await checkConnection(async(_,o)=>new Response(null,{status:o.method==='GET'?405:200}));
  assert.equal(result.ready,false);assert.equal(result.code,'UNSIGNED_REQUEST_NOT_REJECTED');
});

test('network errors do not leak their details',async()=>{
  const result=await checkConnection(async()=>{throw Error('private error text');});
  assert.equal(result.ready,false);assert.equal(result.code,'CONNECTION_FAILED');
  assert.ok(!JSON.stringify(result).includes('private error text'));
});
