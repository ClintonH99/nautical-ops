import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { WEB_ICON_FILES, withWebIcons } from './web-icons.mjs';

test('replaces the old favicon without changing page content', () => {
  const html =
    '<html><head><title>Nautical Ops</title><link rel="icon" href="/favicon.ico"/></head><body>Unchanged</body></html>';
  const result = withWebIcons(html);
  assert.ok(!result.includes('/favicon.ico'));
  assert.ok(result.includes('<title>Nautical Ops</title>'));
  assert.ok(result.includes('<body>Unchanged</body>'));
  assert.equal((result.match(/rel="icon"/g) || []).length, 1);
  assert.ok(result.includes('sizes="96x96" href="/favicon-vessel.png"'));
  assert.ok(result.includes('rel="apple-touch-icon"'));
  assert.ok(result.includes('rel="manifest"'));
  assert.equal(withWebIcons(result), result);
});

test('supports every static website page and rejects malformed shells', () => {
  for (const page of [
    'landing',
    'pricing',
    'support',
    'privacy-policy',
    'refund-policy',
    'terms-and-conditions',
  ]) {
    const html = readFileSync(new URL(`../public/${page}.html`, import.meta.url), 'utf8');
    assert.ok(withWebIcons(html).includes('/favicon-vessel.png'), page);
  }
  assert.throws(() => withWebIcons('<body/>'), /Missing HTML head/);
});

test('icon files have the declared PNG dimensions and manifest paths exist', () => {
  for (const [name, size] of [
    ['favicon-vessel.png', 96],
    ['apple-touch-icon.png', 180],
    ['nautical-ops-icon-192.png', 192],
    ['nautical-ops-icon-512.png', 512],
  ]) {
    const png = readFileSync(new URL(`../public/${name}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  const manifest = JSON.parse(
    readFileSync(new URL('../public/site.webmanifest', import.meta.url), 'utf8')
  );
  assert.equal(manifest.name, 'Nautical Ops');
  assert.equal(manifest.start_url, '/login');
  for (const icon of manifest.icons) assert.ok(WEB_ICON_FILES.includes(icon.src.slice(1)));
});
