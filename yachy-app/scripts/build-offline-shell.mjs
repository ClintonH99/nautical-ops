import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only public build assets are cached. API responses and user records never enter CacheStorage.
export async function buildOfflineShell(dist) {
  const assets = ['/index.html'];
  async function walk(folder) {
    for (const item of await readdir(join(dist, folder), { withFileTypes: true })) {
      const path = `${folder}/${item.name}`;
      if (item.isDirectory()) await walk(path);
      else if (/\.(?:js|css|png|jpg|jpeg|webp|gif|svg|ttf|woff2?|otf)$/.test(path))
        assets.push('/' + path);
    }
  }
  for (const folder of ['assets', '_expo', 'offline-pdf']) {
    try {
      if ((await stat(join(dist, folder))).isDirectory()) await walk(folder);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  assets.sort();
  const hash = createHash('sha256');
  let bytes = 0;
  for (const asset of assets) {
    const data = await readFile(join(dist, asset));
    bytes += data.length;
    hash.update(asset);
    hash.update(data);
  }
  if (bytes > 100 * 1024 * 1024)
    throw Error('Offline app shell exceeds 100 MB; review assets before release');
  const template = await readFile(
    new URL('../src/offline/service-worker.template.js', import.meta.url),
    'utf8'
  );
  const worker = template
    .replace('__OFFLINE_BUILD__', JSON.stringify(hash.digest('hex').slice(0, 24)))
    .replace('__OFFLINE_ASSETS__', JSON.stringify(assets));
  await writeFile(join(dist, 'offline-worker.js'), worker);
  console.log(`Offline shell: ${assets.length} public assets, ${(bytes / 1048576).toFixed(1)} MB`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildOfflineShell(fileURLToPath(new URL('../dist/', import.meta.url)));
}
