import test from 'node:test';
import assert from 'node:assert/strict';
import { getModernSupabaseKey, withModernSupabaseKeys } from '../yachy-app/supabase/functions/_shared/modernSupabaseKeys.mjs';

const publicKey = 'sb_publishable_synthetic_test_only';
const secretKey = 'sb_secret_synthetic_test_only';
const env = {
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: publicKey }),
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: secretKey }),
  SUPABASE_ANON_KEY: 'revoked-public',
  SUPABASE_SERVICE_ROLE_KEY: 'revoked-admin',
  PADDLE_CHECKOUT_ENABLED: 'false',
};
test('uses the correct replacement key, never the legacy key', () => {
  assert.equal(getModernSupabaseKey(k => env[k], 'publishable'), publicKey);
  assert.equal(getModernSupabaseKey(k => env[k], 'secret'), secretKey);
});
test('fails closed for missing, malformed, wrong-type or wrong-role replacements', () => {
  for (const value of [undefined, '', '{secret-parser-input', 'null', '[]', '"string"', '{}', '{"default":42}', JSON.stringify({ default: publicKey }), JSON.stringify({ default: 'eyJlegacy' }), JSON.stringify({ default: 'sb_secret_' }), JSON.stringify({ default: 'sb_secret_bad\nvalue' })]) {
    assert.throws(() => getModernSupabaseKey(k => k === 'SUPABASE_SECRET_KEYS' ? value : env[k], 'secret'), {
      message: 'Replacement Supabase secret key is not configured',
    });
  }
});
test('requires the default key and does not guess another key', () => {
  assert.throws(() => getModernSupabaseKey(() => JSON.stringify({ other: secretKey }), 'secret'));
});
test('adapter retains non-key configuration and disabled billing gates', () => {
  const getEnv = withModernSupabaseKeys(k => env[k]);
  assert.equal(getEnv('SUPABASE_ANON_KEY'), publicKey);
  assert.equal(getEnv('SUPABASE_SERVICE_ROLE_KEY'), secretKey);
  assert.equal(getEnv('PADDLE_CHECKOUT_ENABLED'), 'false');
  assert.equal(getEnv('UNKNOWN'), undefined);
});
test('adapter never reads legacy credentials', () => {
  const reads = [];
  const getEnv = withModernSupabaseKeys(k => { reads.push(k); return env[k]; });
  getEnv('SUPABASE_ANON_KEY'); getEnv('SUPABASE_SERVICE_ROLE_KEY');
  assert.deepEqual(reads, ['SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_SECRET_KEYS']);
});
test('rejects unsupported key roles', () => {
  assert.throws(() => getModernSupabaseKey(k => env[k], 'admin'), { message: 'Unsupported Supabase key type' });
});
