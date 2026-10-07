/**
 * Ensures static marketing/legal pages exist in dist/ after expo export.
 * Expo usually copies public/*, but CI/Vercel can differ; this step is idempotent.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WEB_ICON_FILES, withWebIcons } from './web-icons.mjs';
import { publicPaddleScript } from './paddle-web-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, '..');
const publicDir = path.join(appRoot, 'public');
const distDir = path.join(appRoot, 'dist');

const FILES = [
  'landing.html',
  'pricing.html',
  'privacy-policy.html',
  'terms-and-conditions.html',
  'refund-policy.html',
  'support.html',
  'checkout.html',
  'paddle-checkout.js',
  ...WEB_ICON_FILES,
];

console.log('[copy-public-to-dist] public → dist');

if (!fs.existsSync(distDir)) {
  console.error('[copy-public-to-dist] dist/ missing — run expo export first');
  process.exit(1);
}

let copied = 0;
for (const name of FILES) {
  const src = path.join(publicDir, name);
  const dest = path.join(distDir, name);
  if (!fs.existsSync(src)) {
    console.error('[copy-public-to-dist] missing source:', src);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
  copied += 1;
  console.log('[copy-public-to-dist]', name);
}

for (const name of ['index.html', ...FILES.filter((name) => name.endsWith('.html'))]) {
  const file = path.join(distDir, name);
  fs.writeFileSync(file, withWebIcons(fs.readFileSync(file, 'utf8')));
}
fs.writeFileSync(path.join(distDir, 'paddle-checkout-config.js'), publicPaddleScript(process.env));

console.log('[copy-public-to-dist] done,', copied, 'files');
