// Keep web PDF assets inside the application bundle, with no runtime asset fetch.
// Regenerate after replacing either approved source asset.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const assets = {
  logo: fs.readFileSync(new URL('assets/sea-miles-pdf-logo-source.png', root)).toString('base64'),
  signatureFont: fs
    .readFileSync(new URL('assets/fonts/AlexBrush-Regular.ttf', root))
    .toString('base64'),
};
const output = new URL('src/utils/pdfEmbeddedAssets.json', root);
fs.writeFileSync(output, `${JSON.stringify(assets, null, 2)}\n`);
console.log(`Embedded approved PDF assets: ${fileURLToPath(output)}`);
