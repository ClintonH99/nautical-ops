import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedCheck } from '../yachy-app/src/offline/boundedCheck.ts';
test('stalled auth reads end promptly; a late answer cannot resume a timed-out sync', async () => {
  let resolve, continued = false;
  const read = new Promise(r => resolve = r);
  const sync = (async () => { await boundedCheck(read,10); continued = true; })();
  await assert.rejects(sync,/ONLINE_CHECK_UNAVAILABLE/);
  resolve('late token');
  await Promise.resolve();
  assert.equal(continued,false);
  assert.equal(await boundedCheck(Promise.resolve('verified'),10),'verified');
  await assert.rejects(boundedCheck(Promise.reject(new Error('Denied')),10),/Denied/);
});
