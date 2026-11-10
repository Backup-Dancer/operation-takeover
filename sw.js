/* Service worker for the GitHub Pages build. Stamped with the build id
 * at stage time. Scope is the directory this file is served from (./),
 * which is /operation-takeover/ on a project site. Network-first for
 * navigations and scripts so a new cache-bust is not sticky. */
const BUILD = 'iv-4.1.0';
const CACHE = 'takeover-' + BUILD;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const dest = req.destination;
  const networkFirst = dest === 'document' || dest === 'script' || dest === 'empty';
  event.respondWith((async () => {
    if (networkFirst) {
      try {
        const fresh = await fetch(req);
        return fresh;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw err;
      }
    }
    const cached = await caches.match(req);
    if (cached) return cached;
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const copy = fresh.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return fresh;
  })());
});
