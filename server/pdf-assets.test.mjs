import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('embedded PDF logo and signature font exactly match approved source files', () => {
  const root = new URL('../yachy-app/', import.meta.url);
  const bundled = JSON.parse(fs.readFileSync(new URL('src/utils/pdfEmbeddedAssets.json', root), 'utf8'));
  for (const [key, file] of [
    ['logo', 'assets/sea-miles-pdf-logo-source.png'],
    ['signatureFont', 'assets/fonts/AlexBrush-Regular.ttf'],
  ]) {
    assert.deepEqual(Buffer.from(bundled[key], 'base64'), fs.readFileSync(new URL(file, root)),
      'Run node yachy-app/scripts/embed-pdf-assets.mjs after updating PDF assets');
  }
});
