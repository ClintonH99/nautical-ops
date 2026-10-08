import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const policy = config.routes[0];
test('security headers cover all routes before filesystem and SPA rewrites', () => {
  assert.equal(policy.src, '/(.*)');
  assert.equal(policy.continue, true);
  assert.equal(policy.dest, undefined);
  assert.equal(config.headers, undefined); // Vercel forbids mixing headers and routes
  for (const route of ['/', '/login', '/checkout', '/api/export-pdf', '/landing.js']) {
    assert.ok(new RegExp(`^${policy.src}$`).test(route));
  }
  assert.equal(config.routes[1].dest, '/landing.html');
  assert.equal(config.routes[2].handle, 'filesystem');
  assert.equal(config.routes.at(-1).dest, '/index.html');
});
test('anti-framing, MIME and referrer protections are enforced without blocking Paddle frames', () => {
  assert.equal(policy.headers['X-Frame-Options'], 'DENY');
  assert.equal(policy.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(policy.headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(policy.headers['Content-Security-Policy'], "base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
  // frame-ancestors controls who embeds us; it does not prevent our Paddle checkout iframe.
  assert.doesNotMatch(policy.headers['Content-Security-Policy'], /frame-src|script-src/);
  assert.match(policy.headers['Permissions-Policy'], /camera=\(self\)/);
  assert.match(policy.headers['Permissions-Policy'], /geolocation=\(self\)/);
  assert.match(policy.headers['Permissions-Policy'], /https:\/\/buy\.paddle\.com/);
});
test('full resource CSP starts report-only pending real checkout and app browser verification', () => {
  const report = policy.headers['Content-Security-Policy-Report-Only'];
  assert.match(report, /script-src 'self' https:\/\/cdn\.paddle\.com/);
  assert.match(report, /wss:\/\/\*\.supabase\.co/);
  assert.match(report, /frame-src https:\/\/\*\.paddle\.com/);
  assert.doesNotMatch(report, /unsafe-eval/);
});
