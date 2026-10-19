// Exercise the actual Metro production modules without starting the app or
// connecting to any account. Source-level mocks cannot catch bundler interop bugs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { PDFDocument } from 'pdf-lib';

const directory = new URL('../dist/_expo/static/js/web/', import.meta.url);
const files = (await fs.readdir(directory)).filter((name) => /^index-.*\.js$/.test(name));
assert.equal(files.length, 1, 'Build the web application before checking its PDF bundle.');
const source = await fs.readFile(new URL(files[0], directory), 'utf8');
const definition = source
  .split('\n')
  .find((line) => line.startsWith('__d(') && line.includes('e.brandPdf='));
assert.ok(definition, 'The production bundle must contain the PDF branding module.');
const id = definition.match(/},(\d+),\[/)?.[1];
assert.ok(id, 'Could not identify the Metro PDF module.');
const context = vm.createContext({ console, setTimeout, clearTimeout, TextDecoder, TextEncoder });
// Keep Metro's real runtime and module registration, but do not launch the app.
vm.runInContext(source.replace(/^__r\(\d+\);?$/gm, ''), context, { timeout: 10_000 });
const { brandPdf } = vm.runInContext(`__r(${id})`, context);
const original = await PDFDocument.create();
original.addPage([595, 842]);
original.addPage([595, 842]);
const logo = await fs.readFile(new URL('../assets/sea-miles-pdf-logo-source.png', import.meta.url));
const branded = await brandPdf(await original.saveAsBase64(), 'Inventory', logo.toString('base64'));
const result = await PDFDocument.load(branded);
assert.equal(result.getPageCount(), 2, 'Branding must not change pagination.');
for (const page of result.getPages()) {
  const resources = page.node.normalizedEntries();
  assert.ok(resources.Font.keys().length >= 2, 'Expected branded text fonts.');
  assert.ok(resources.XObject.keys().length >= 1, 'Expected the approved vessel logo.');
}
console.log('[check-web-pdf-bundle] Production PDF branding passed (2 pages, logo and fonts).');
