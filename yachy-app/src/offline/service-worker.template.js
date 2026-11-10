/* Generated during export. No API, auth, payment or user-data caching. */
const BUILD = __OFFLINE_BUILD__;
const ASSETS = __OFFLINE_ASSETS__;
const CACHE = 'nautical-ops-shell-' + BUILD;
const ALLOWED_ASSETS = new Set(ASSETS);
const OFFLINE_ROUTES =
  /^\/(?:app|categories|notepad(?:\/edit)?|notes(?:\/edit)?|trips(?:\/.*)?|crew-leave(?:\/.*)?|safety(?:\/.*)?|rules(?:\/.*)?|pre-departure(?:\/.*)?|tasks(?:\/.*)?|yard-period(?:\/.*)?|maintenance(?:\/.*)?|watch-keeping|hours-of-rest(?:\/.*)?|watch-duties|watch-schedule(?:\/.*)?|shopping(?:\/.*)?|inventory(?:\/.*)?|uniforms(?:\/.*)?|logs(?:\/.*)?|contractors(?:\/edit)?)\/?$/;
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Installation is atomic: a missing asset prevents this version becoming ready.
      await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    })()
  );
  // No skipWaiting: do not replace an open app or interrupt unsynced edits.
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('nautical-ops-shell-') && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })()
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    const noteEditQuery =
      url.pathname === '/notepad/edit' &&
      [...url.searchParams.keys()].length === 1 &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        url.searchParams.get('noteId') || ''
      );
    const shoppingQuery =
      ['/shopping/list', '/shopping/edit'].includes(url.pathname) &&
      [...url.searchParams.keys()].every(
        (key, index, keys) =>
          keys.indexOf(key) === index &&
          ((key === 'listType' && ['general', 'trip'].includes(url.searchParams.get(key))) ||
            (key === 'listId' &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                url.searchParams.get(key) || ''
              )) ||
            (key === 'asMasterList' && ['true', 'false'].includes(url.searchParams.get(key))) ||
            (key === 'presetTitle' && url.searchParams.get(key) === 'Trip Shopping'))
      );
    const publicationId = {
      '/rules/create': 'ruleId',
      '/maintenance/edit': 'logId',
      '/logs/pump-out/edit': 'logId',
      '/logs/general-waste/edit': 'logId',
      '/uniforms/edit': 'uniformId',
      '/safety/equipment/create': 'equipmentId',
      '/safety/muster/create': 'musterStationId',
    }[url.pathname];
    const publicationQuery =
      publicationId &&
      [...url.searchParams.keys()].length === 1 &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        url.searchParams.get(publicationId) || ''
      );
    const contractorQuery =
      url.pathname === '/contractors/edit' &&
      [...url.searchParams.keys()].length === 1 &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        url.searchParams.get('contractorId') || ''
      );
    const yardQuery =
      url.pathname === '/yard-period/edit' &&
      [...url.searchParams.keys()].every(
        (key, index, keys) =>
          keys.indexOf(key) === index &&
          ['jobId', 'tripId'].includes(key) &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            url.searchParams.get(key) || ''
          )
      );
    const tripQuery =
      url.pathname === '/trips/edit' &&
      [...url.searchParams.keys()].every(
        (key, index, keys) =>
          keys.indexOf(key) === index &&
          ((key === 'type' &&
            ['GUEST', 'BOSS', 'DELIVERY', 'YARD_PERIOD'].includes(url.searchParams.get(key))) ||
            (key === 'tripId' &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                url.searchParams.get(key) || ''
              )))
      );
    const taskQuery =
      ['/tasks/list', '/tasks/edit'].includes(url.pathname) &&
      [...url.searchParams.keys()].every(
        (key, index, keys) =>
          keys.indexOf(key) === index &&
          ((key === 'category' &&
            ['DAILY', 'WEEKLY', 'MONTHLY'].includes(url.searchParams.get(key))) ||
            (key === 'taskId' &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                url.searchParams.get(key) || ''
              )))
      );
    if (
      (url.pathname !== '/' && !OFFLINE_ROUTES.test(url.pathname)) ||
      (url.search &&
        !noteEditQuery &&
        !shoppingQuery &&
        !taskQuery &&
        !contractorQuery &&
        !publicationQuery &&
        !tripQuery &&
        !yardQuery) ||
      url.hash
    )
      return;
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match('/index.html')) ||
            new Response('Reconnect to download Nautical Ops.', { status: 503 })
          );
        }
      })()
    );
    return;
  }
  if (!ALLOWED_ASSETS.has(url.pathname) || url.search || url.pathname === '/index.html') return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(url.pathname)) || fetch(request);
    })()
  );
});
